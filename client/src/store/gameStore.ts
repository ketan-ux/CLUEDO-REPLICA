/**
 * Client-side game store.
 *
 * The tab that created the room is the *host*: it owns the only copy of the true
 * state (hands + sealed envelope) and it is the only place the engine runs. Every
 * other tab is a client that sends intents and renders masked snapshots.
 *
 * Because masking is a pure function of a full state, clients keep a tiny ring
 * buffer of the host's full broadcasts, which lets them re-render the state
 * *before* their own click appended — the "lag compensation" step.
 */
import { addHuman, createLobby, maskState, playerById, reduce } from '@shared/engine.js';
import { autoPlayTurn, autoReveal, botDecide, botDisprove, nextFreeSuspect } from '@shared/ai.js';
import type { Action, GameState, MaskedState } from '@shared/types.js';
import { createTransport, lookupRoom, relayAvailable, type Transport, type TransportStatus } from '../net/transport';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeCode(len = 4): string {
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return out;
}

const STORAGE = {
  peer: 'cluedo.peerId',
  name: 'cluedo.name',
};

/**
 * Storage that never throws: private modes, disabled cookies and workers all
 * behave as if nothing was stored, and the session simply starts fresh.
 */
const safeStorage = {
  get(key: string): string | null {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      /* the game continues without persistence */
    }
  },
};

function loadPeerId(): string {
  let id = safeStorage.get(STORAGE.peer);
  if (!id) {
    id = `p-${Math.random().toString(36).slice(2, 10)}`;
    safeStorage.set(STORAGE.peer, id);
  }
  return id;
}

export type Mode = 'local' | 'online-host' | 'online-client';

export interface StoreMeta {
  mode: Mode;
  code: string;
  youId: string;
  name: string;
  /** True until the first relay probe has settled. */
  booting: boolean;
  serverAvailable: boolean;
  connection: TransportStatus | 'local';
  notice: string | null;
  error: string | null;
  peers: number;
}

export interface StoreView {
  state: MaskedState | null;
  meta: StoreMeta;
}

type Listener = () => void;

export class GameStore {
  meta: StoreMeta;
  state: MaskedState | null = null;
  /** Host only: the one true copy, envelope and all. */
  master: GameState | null = null;

  private listeners = new Set<Listener>();
  private view: StoreView;
  private transport: Transport | null = null;
  private botTimer: ReturnType<typeof setTimeout> | null = null;
  private promptTimer: ReturnType<typeof setTimeout> | null = null;
  private absentTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingActionId: string | null = null;
  private pendingSince = 0;
  private actionSeq = 0;
  private peerIds = new Set<string>();
  private booted = false;
  private probeTimer: ReturnType<typeof setInterval> | null = null;
  private probeBusy = false;

  constructor() {
    this.meta = {
      mode: 'local',
      code: makeCode(),
      youId: loadPeerId(),
      name: safeStorage.get(STORAGE.name) ?? '',
      booting: true,
      serverAvailable: false,
      connection: 'local',
      notice: null,
      error: null,
      peers: 0,
    };
    this.view = { state: null, meta: this.meta };
  }

  /* ---------------- subscription ---------------- */

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getView = (): StoreView => this.view;

  private emit(): void {
    this.view = { state: this.state, meta: { ...this.meta } };
    for (const fn of this.listeners) fn();
  }

  setMeta(patch: Partial<StoreMeta>): void {
    this.meta = { ...this.meta, ...patch };
    this.emit();
  }

  setNotice(notice: string | null): void {
    this.setMeta({ notice });
  }

  /* ---------------- boot ---------------- */

  async boot(force = false): Promise<void> {
    if (this.booted && !force) return;
    if (this.booted && force) {
      // The escape hatch on the loading card: guarantee a table exists, then
      // let the normal probe run again when the caller forces it.
      this.ensureMaster();
      this.publish();
      this.startProbing();
      return;
    }
    this.booted = true;
    if (typeof window !== 'undefined') {
      // Losing the host tab ends the case for everyone, so warn once.
      window.addEventListener('beforeunload', (e) => {
        const s = this.master;
        if (!s || this.meta.mode === 'online-client') return;
        if (s.phase === 'LOBBY' || s.phase === 'GAME_OVER' || !this.peerIds.size) return;
        e.preventDefault();
        e.returnValue = 'You are hosting a live case. Leaving will end it for every detective.';
      });
    }
    // The table exists from the very first paint: whether or not a relay ever
    // answers, the player can deal a hand and play. Relaying is an upgrade, not
    // a prerequisite.
    this.ensureMaster();
    this.publish();

    // Whatever the network does — DNS failure, a throwing constructor, an
    // exotic environment — the table stays playable and the UI stops waiting.
    let available = false;
    try {
      available = await relayAvailable(2600);
      if (available) await this.becomeHost(this.meta.code);
    } catch {
      available = false;
    }
    if (available) {
      this.meta = { ...this.meta, serverAvailable: true, booting: false };
    } else {
      this.meta = { ...this.meta, serverAvailable: false, booting: false, mode: 'local', connection: 'local' };
      this.startProbing();
    }
    this.ensureMaster();
    this.publish();
  }

  /**
   * Offline tables keep watching for a relay. If one appears — a cold start, a
   * blip in the network, a proxy that was resting — the table goes live without
   * the player having to reload or restart the case.
   */
  private startProbing(): void {
    if (this.probeTimer) return;
    this.probeTimer = setInterval(() => {
      void this.probeOnce();
    }, 10_000);
  }

  private async probeOnce(): Promise<void> {
    if (this.probeBusy) return;
    if (this.meta.mode !== 'local') {
      this.stopProbing();
      return;
    }
    this.probeBusy = true;
    try {
      if (await relayAvailable(2600)) {
        this.stopProbing();
        this.setMeta({ serverAvailable: true, error: null });
        try {
          await this.becomeHost(this.meta.code);
          this.setNotice(`The relay is answering again — table ${this.meta.code} is live. Share the code.`);
        } catch {
          this.setMeta({ mode: 'local', connection: 'local' });
        }
      }
    } finally {
      this.probeBusy = false;
    }
  }

  private stopProbing(): void {
    if (this.probeTimer) clearInterval(this.probeTimer);
    this.probeTimer = null;
  }

  /** Retry the relay on demand (the button on the home card). */
  async retryRelay(): Promise<void> {
    if (this.meta.mode !== 'local') return;
    let up = false;
    try {
      up = await relayAvailable(2600);
    } catch {
      up = false;
    }
    if (!up) {
      this.setMeta({ error: 'Still no relay answering. You can keep playing this private table.' });
      return;
    }
    this.stopProbing();
    this.setMeta({ serverAvailable: true, error: null });
    try {
      await this.becomeHost(this.meta.code);
      this.setNotice(`Live multiplayer is on. Table code ${this.meta.code}.`);
    } catch {
      this.setMeta({ error: 'The relay answered but refused the connection. Playing this table privately.' });
      this.setMeta({ mode: 'local', connection: 'local' });
      this.startProbing();
    }
  }

  setName(name: string): void {
    safeStorage.set(STORAGE.name, name);
    this.meta = { ...this.meta, name };
    this.emit();
  }

  /* ---------------- hosting ---------------- */

  private connect(role: 'host' | 'client'): void {
    this.transport?.close();
    this.transport = createTransport({
      code: this.meta.code,
      peerId: this.meta.youId,
      role,
      onMessage: (msg) => this.onMessage(msg),
      onStatus: (status) => this.setMeta({ connection: status }),
    });
  }

  async becomeHost(code = this.meta.code): Promise<void> {
    this.meta = { ...this.meta, code, mode: 'online-host' };
    if (!this.master || this.master.code !== code) this.master = createLobby(code);
    this.ensureHostFlag();
    this.connect('host');
    this.publish();
  }

  async joinRoom(code: string): Promise<boolean> {
    const { hosted } = await lookupRoom(code);
    if (!hosted) {
      this.setMeta({ error: `No table is answering on code ${code}. Check the letters, or host your own.` });
      return false;
    }
    this.stopProbing();
    this.meta = { ...this.meta, code, mode: 'online-client', error: null };
    this.master = null;
    this.connect('client');
    this.publish();
    return true;
  }

  /** Back to a private, offline table (used when the relay is unreachable). */
  goOffline(): void {
    this.transport?.close();
    this.transport = null;
    this.meta = { ...this.meta, mode: 'local', connection: 'local', code: makeCode(), peers: 0 };
    this.master = null;
    this.ensureMaster();
    this.publish();
    this.startProbing();
  }

  /* ---------------- messages ---------------- */

  private onMessage(msg: Record<string, any>): void {
    switch (msg.t) {
      case 'hello':
        this.setMeta({ connection: 'open' });
        if (this.meta.mode === 'online-client') {
          // Announce ourselves and ask the host for the current table.
          this.transport?.send({ t: 'req', kind: 'join', peer: this.meta.youId, name: this.meta.name });
        }
        break;

      case 'req': {
        // Host: somebody arrived or left.
        if (this.meta.mode !== 'online-host') break;
        if (msg.kind === 'join') {
          this.peerIds.add(msg.peer);
          this.setMeta({ peers: this.peerIds.size });
          this.admitPeer(msg.peer, msg.name);
        } else if (msg.kind === 'leave') {
          this.peerIds.delete(msg.peer);
          this.setMeta({ peers: this.peerIds.size });
          this.markDisconnected(msg.peer);
        }
        this.publish();
        break;
      }

      case 'state': {
        if (this.meta.mode !== 'online-client') break;
        this.applyEnvelope(msg.envelope, msg.meta);
        break;
      }

      case 'action': {
        if (this.meta.mode !== 'online-host') break;
        const action = msg.action as Action;
        const actionId = String(msg.actionId ?? '');
        const senderId = String(msg.from ?? '');
        if (action?.playerId !== senderId) break; // never act on another player's behalf
        const res = this.applyHost(action, senderId);
        if (res) {
          this.publish(actionId);
        } else {
          // Never leave a client guessing why nothing happened.
          this.transport?.send({ t: 'error', to: senderId, error: this.lastError, actionId });
        }
        break;
      }

      case 'error': {
        if (msg.actionId && msg.actionId === this.pendingActionId) this.pendingActionId = null;
        this.setNotice(msg.error === 'host-offline' ? 'The host has left the table.' : String(msg.error));
        break;
      }

      default:
        break;
    }
  }

  /** Host: seat a newly arrived peer, or re-connect an existing detective. */
  private admitPeer(peerId: string, name?: string): void {
    const s = this.master;
    if (!s) return;
    if (s.phase === 'LOBBY') {
      if (s.players.some((p) => p.id === peerId)) return;
      if (s.players.length >= 6) return; // seventh arrival watches from the gallery
      const suspectId = nextFreeSuspect(s) ?? 'scarlet';
      const label = (name || `Detective ${s.players.length + 1}`).slice(0, 22);
      this.master = addHuman(s, peerId, label, suspectId, false);
    } else {
      const p = playerById(s, peerId);
      if (!p) return; // late arrival: observer view, published below
      if (!p.connected) {
        const next = structuredClone(s);
        const target = playerById(next, peerId);
        if (target) target.connected = true;
        this.master = next;
      }
    }
    this.driveHost();
  }

  private markDisconnected(peerId: string): void {
    const s = this.master;
    if (!s) return;
    const p = playerById(s, peerId);
    if (!p || !p.connected) return;
    const next = structuredClone(s);
    const target = playerById(next, peerId);
    if (target) target.connected = false;
    this.master = next;
    if (next.phase !== 'LOBBY') {
      this.logNotice(next, `${p.name} has stepped away from the table — their turn will be held.`);
    }
    this.driveHost();
  }

  private logNotice(s: GameState, text: string): void {
    s.log.push({
      id: `l${++s.seq}`,
      turn: s.turn,
      t: Date.now(),
      kind: 'system',
      text,
      visibleTo: null,
      tone: 'neutral',
    });
  }

  /* ---------------- dispatch ---------------- */

  dispatch(action: Action, opts: { silent?: boolean; fromBot?: boolean } = {}): void {
    if (this.meta.mode === 'online-client') {
      const actionId = `a${++this.actionSeq}`;
      this.pendingActionId = actionId;
      this.pendingSince = Date.now();
      // Private-only intents are applied locally at once (perfect prediction —
      // they cannot touch anyone else's view); everything else waits for the
      // host's authoritative echo, which arrives on the same tick locally.
      this.predictPrivate(action);
      this.transport?.send({ t: 'action', action, actionId });
      return;
    }
    this.ensureMaster();
    const applied = this.applyHost(action, action.playerId);
    if (applied) {
      this.publish();
    } else if (!opts.silent && !opts.fromBot) {
      this.setNotice(this.lastError);
    }
  }

  /** The host always has a lobby, even before the relay has been probed. */
  private ensureMaster(): GameState {
    if (!this.master) {
      this.master = createLobby(this.meta.code);
      this.ensureHostFlag();
    }
    return this.master;
  }

  /** Notebook, scratchpad and modal dismissals are local-only concerns. */
  private predictPrivate(action: Action): void {
    const s = this.state;
    if (!s) return;
    if (action.type === 'SET_NOTE') {
      this.state = { ...s, notebook: { ...s.notebook, [action.item]: action.stamp } };
      this.emit();
    } else if (action.type === 'SET_SCRATCH') {
      this.state = { ...s, notes: action.text };
      this.emit();
    } else if (action.type === 'DISMISS_MODAL') {
      this.state = { ...s, modals: s.modals.filter((m) => m.id !== action.modalId) };
      this.emit();
    }
  }

  private lastError = '';

  /** Run one action through the engine on the host. */
  private applyHost(action: Action, _actorId: string): boolean {
    if (!this.master) return false;
    const res = reduce(this.master, action);
    if (!res.ok) {
      this.lastError = res.error;
      return false;
    }
    this.master = res.state;
    this.ensureHostFlag();
    return true;
  }

  /**
   * Hosting is a property of the *tab*, not of the engine: whoever owns the
   * master copy holds the gavel, even after taking a seat at the table.
   */
  private ensureHostFlag(): void {
    const s = this.master;
    if (!s) return;
    if (this.meta.mode === 'online-client') return;
    const hostId = this.meta.mode === 'local' ? null : this.meta.youId;
    for (const p of s.players) {
      const shouldHost = hostId ? p.id === hostId : false;
      if (p.isHost !== shouldHost) p.isHost = shouldHost;
    }
    if (!hostId && s.players.length && !s.players.some((p) => p.isHost)) {
      // Offline table: the lone local detective is the host so they can deal.
      const firstHuman = s.players.find((p) => !p.isBot);
      if (firstHuman) firstHuman.isHost = true;
    }
  }

  private publish(actionId?: string): void {
    const s = this.master;
    if (!s) return;
    if (this.meta.mode === 'online-host' || this.meta.mode === 'local') {
      this.state = maskState(s, this.meta.youId);
      for (const peer of this.peerIds) {
        const envelope = maskState(s, peer);
        this.transport?.send({ t: 'state', to: peer, envelope, meta: { actionId } });
      }
    }
    this.emit();
    this.driveHost();
  }

  /* ---------------- client inbox ---------------- */

  private applyEnvelope(envelope: MaskedState, meta?: { actionId?: string }): void {
    if (!envelope) return;
    if (meta?.actionId && meta.actionId === this.pendingActionId) {
      // Our own move has come back around: trust the host verbatim.
      this.pendingActionId = null;
    } else if (this.pendingActionId && Date.now() - this.pendingSince > 4000) {
      this.pendingActionId = null; // the intent seems to have been dropped
    }
    // While an intent of ours is in flight, keep our own scratchpad and stamps
    // in front of the host's slightly older copy.
    const keepPrivate = this.pendingActionId !== null && this.state;
    this.state = keepPrivate
      ? {
          ...envelope,
          hand: this.state!.hand,
          notebook: this.state!.notebook,
          notes: this.state!.notes,
        }
      : envelope;
    this.emit();
  }

  /** Is one of our own intents still travelling? Drives the "…" button state. */
  get awaitingHost(): boolean {
    return this.pendingActionId !== null;
  }

  /* ---------------- host timers: bots & stalled humans ---------------- */

  private clearTimers(): void {
    if (this.botTimer) clearTimeout(this.botTimer);
    if (this.promptTimer) clearTimeout(this.promptTimer);
    if (this.absentTimer) clearTimeout(this.absentTimer);
    this.botTimer = null;
    this.promptTimer = null;
    this.absentTimer = null;
  }

  private driveHost(): void {
    this.clearTimers();
    if (this.meta.mode === 'online-client') return;
    const s = this.master;
    if (!s || s.phase === 'LOBBY' || s.phase === 'GAME_OVER') return;

    const thinkTime = 800 + Math.random() * 400; // 800–1200 ms, so humans can follow

    const botAction = botDecide(s);
    if (botAction) {
      this.botTimer = setTimeout(() => {
        this.botTimer = null;
        this.dispatch(botAction, { fromBot: true, silent: true });
      }, thinkTime);
      return;
    }

    const botReveal = botDisprove(s);
    if (botReveal) {
      this.botTimer = setTimeout(() => {
        this.botTimer = null;
        this.dispatch(botReveal, { fromBot: true, silent: true });
      }, thinkTime);
      return;
    }

    // A detective who has dropped off mid-turn must not freeze the table.
    const active = playerById(s, s.players[s.turnIndex].id);
    if (active && !active.isBot && !active.connected) {
      this.absentTimer = setTimeout(() => {
        const auto = autoPlayTurn(this.master ?? s);
        if (auto) this.dispatch(auto, { fromBot: true, silent: true });
      }, 25_000);
      return;
    }

    if (s.pendingPrompt) {
      const queried = playerById(s, s.pendingPrompt.playerId);
      if (queried && !queried.isBot && !queried.connected) {
        // A player who has walked away must not freeze the case.
        this.promptTimer = setTimeout(() => {
          const auto = autoReveal(s);
          if (auto) this.dispatch(auto, { fromBot: true, silent: true });
        }, 20_000);
      } else {
        this.promptTimer = setTimeout(() => {
          const cur = this.master;
          if (!cur?.pendingPrompt) return;
          const auto = autoReveal(cur);
          if (auto) this.dispatch(auto, { fromBot: true, silent: true });
        }, 60_000);
      }
    }
  }

  /* ---------------- convenience ---------------- */

  get hostState(): GameState | null {
    return this.master;
  }

  get mode(): Mode {
    return this.meta.mode;
  }

  /** Stop every timer and socket — used when a tab leaves and by the tests. */
  shutdown(): void {
    this.clearTimers();
    this.stopProbing();
    this.transport?.close();
    this.transport = null;
    this.listeners.clear();
  }
}

export const store = new GameStore();
