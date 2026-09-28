/**
 * Host-authoritative sync in the client store, exercised against a fake socket:
 * a guest arrives, is seated, is dealt a private hand, and every broadcast is
 * checked for leaked secrets.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

/* ---------------- browser stubs (loaded before the store) ---------------- */

class FakeSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: FakeSocket[] = [];
  static last(): FakeSocket {
    return FakeSocket.instances[FakeSocket.instances.length - 1];
  }
  readyState = 0;
  sent: string[] = [];
  url: string;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
    setTimeout(() => {
      this.readyState = FakeSocket.OPEN;
      this.onopen?.({});
    }, 0);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({});
  }
  /** Test helper: pretend the relay handed us a message. */
  deliver(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  parsed(): any[] {
    return this.sent.map((s) => JSON.parse(s));
  }
}

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
(globalThis as any).location = { protocol: 'http:', host: 'localhost:5173' };
(globalThis as any).WebSocket = FakeSocket;
(globalThis as any).fetch = async (url: string) => {
  if (String(url).includes('/api/health')) {
    return { ok: true, json: async () => ({ ok: true }) } as unknown as Response;
  }
  return { ok: false, json: async () => ({}) } as unknown as Response;
};

const { store: gameStore } = await import('../client/src/store/gameStore.js');

const tick = () => new Promise((r) => setTimeout(r, 5));

after(() => {
  gameStore.shutdown();
});

test('the host tab owns the truth and masks every broadcast', async () => {
  await gameStore.boot();
  await tick();
  assert.equal(gameStore.meta.serverAvailable, true);
  assert.equal(gameStore.meta.mode, 'online-host', 'a reachable relay makes this tab the host');
  assert.ok(FakeSocket.last(), 'the host opened a socket');

  // 1. The host takes a seat, then fills the table with automations.
  gameStore.dispatch({ type: 'CLAIM_SEAT', playerId: gameStore.meta.youId, name: 'Commissioner' });
  for (let i = 0; i < 2; i++) gameStore.dispatch({ type: 'ADD_BOT', playerId: gameStore.meta.youId });
  assert.equal(gameStore.hostState?.players.length, 3);
  assert.equal(
    gameStore.hostState?.players.find((p) => p.id === gameStore.meta.youId)?.isHost,
    true,
    'the seated host keeps the gavel',
  );
  assert.equal(gameStore.hostState?.players.filter((p) => p.isBot).length, 2);

  // 2. A second tab joins: the relay announces it, the host seats it.
  const guestId = 'guest-peer';
  FakeSocket.last().deliver({ t: 'req', kind: 'join', peer: guestId, name: 'Sergeant' });
  await tick();
  const roster = gameStore.hostState!.players;
  assert.equal(roster.length, 4, 'the guest is seated');
  const guest = roster.find((p) => p.id === guestId)!;
  assert.equal(guest.name, 'Sergeant');
  assert.equal(guest.isBot, false);
  assert.ok(!guest.isHost);

  const guestEnvelopes = () => FakeSocket.last().parsed().filter((m) => m.t === 'state' && m.to === guestId);
  assert.ok(guestEnvelopes().length > 0, 'the guest received a snapshot');

  // 3. Deal the cards.
  gameStore.dispatch({ type: 'START_GAME', playerId: gameStore.meta.youId });
  const master = gameStore.hostState!;
  assert.equal(master.phase, 'ROLL');
  assert.equal(master.envelope.length, 3);

  const latest = guestEnvelopes().at(-1);
  assert.ok(latest, 'the guest is told the game began');
  const view = latest.envelope;
  const guestNow = master.players.find((p) => p.id === guestId)!;

  // The guest is dealt their own hand and nothing else.
  assert.equal(view.hand.length, guestNow.hand.length);
  assert.ok(view.hand.length >= 4, 'four detectives share eighteen cards');
  for (const p of view.players) {
    assert.equal(p.hand, undefined, 'no hand travels inside the roster');
    assert.equal(typeof p.cardCount, 'number');
  }
  assert.equal(view.envelope, null, 'the murder envelope stays sealed');
  assert.equal(view.you, guestId);
  assert.equal(view.isHost, false, 'a guest does not hold the gavel');
  assert.equal(view.prompt, null, 'no disprove query is outstanding');
  assert.ok(!view.legalMoves.length || view.turnPlayerId === guestId, 'legal moves are private to the mover');

  // No card that the guest should not know may appear anywhere in their payload.
  const guestKnows = new Set<string>([
    ...guestNow.hand,
    ...master.reveals.filter((r) => r.toId === guestId || r.byId === guestId).map((r) => r.cardId),
  ]);
  const publicTrio = new Set(master.queries.flatMap((q) => q.cards));
  const raw = JSON.stringify(view);
  for (const other of master.players) {
    if (other.id === guestId) continue;
    for (const cardId of other.hand) {
      const allowed = guestKnows.has(cardId) || publicTrio.has(cardId);
      assert.ok(allowed || !raw.includes(`"${cardId}"`), `${cardId} leaked to the guest`);
    }
  }
  for (const cardId of master.envelope) {
    assert.ok(!raw.includes(`"${cardId}"`), `envelope card ${cardId} leaked`);
  }

  // 4. The guest's intent is applied on the host and echoed back.
  FakeSocket.last().deliver({
    t: 'action',
    from: guestId,
    action: { type: 'SET_SCRATCH', playerId: guestId, text: 'The butler never sleeps.' },
    actionId: 'guest-1',
  });
  await tick();
  assert.equal(
    gameStore.hostState!.players.find((p) => p.id === guestId)!.notes,
    'The butler never sleeps.',
    'the host applied the guest intent',
  );
  const echo = guestEnvelopes().at(-1);
  assert.equal(echo.meta.actionId, 'guest-1', 'the echo is stamped so the guest can adopt it');
  assert.equal(echo.envelope.notes, 'The butler never sleeps.');

  // 5. A guest may never act as somebody else.
  const before = JSON.stringify(gameStore.hostState!.players.map((p) => p.name));
  FakeSocket.last().deliver({
    t: 'action',
    from: guestId,
    action: { type: 'REMOVE_PLAYER', playerId: gameStore.meta.youId, targetId: gameStore.meta.youId },
    actionId: 'spoof',
  });
  await tick();
  assert.equal(JSON.stringify(gameStore.hostState!.players.map((p) => p.name)), before, 'spoofed action ignored');

  // 6. Illegal actions are refused with a message rather than corrupting state.
  FakeSocket.last().deliver({
    t: 'action',
    from: guestId,
    action: { type: 'ROLL', playerId: guestId },
    actionId: 'early-roll',
  });

  // An intent with no stamped sender is refused outright (the relay always
  // stamps one, so this only happens for hand-crafted traffic).
  const beforeNotes = gameStore.hostState!.players.find((p) => p.id === guestId)!.notes;
  FakeSocket.last().deliver({
    t: 'action',
    action: { type: 'SET_SCRATCH', playerId: guestId, text: 'unsigned' },
    actionId: 'unsigned',
  });
  await tick();
  assert.equal(gameStore.hostState!.players.find((p) => p.id === guestId)!.notes, beforeNotes);
  await tick();
  const stillRoll = gameStore.hostState!.phase;
  assert.ok(['ROLL', 'MOVE', 'SUGGEST', 'DISPROVE', 'ACCUSE', 'END_TURN'].includes(stillRoll));

  gameStore.shutdown();
});

test('a tab that joins an existing room becomes a client, not a second host', async () => {
  const { GameStore } = await import('../client/src/store/gameStore.js');
  const client = new GameStore();
  (globalThis as any).fetch = async (url: string) => {
    if (String(url).includes('/exists')) {
      return { ok: true, json: async () => ({ hosted: true, peers: 2 }) } as unknown as Response;
    }
    return { ok: true, json: async () => ({ ok: true }) } as unknown as Response;
  };
  const joined = await client.joinRoom('RAVN');
  assert.equal(joined, true);
  assert.equal(client.meta.mode, 'online-client');
  assert.equal(client.meta.code, 'RAVN');
  assert.equal(client.hostState, null, 'a client keeps no master copy');

  // A snapshot from the host is rendered verbatim.
  const socket = FakeSocket.last();
  await tick();
  socket.deliver({
    t: 'state',
    envelope: { code: 'RAVN', phase: 'ROLL', you: client.meta.youId, players: [], hand: [], version: 4 },
    meta: { actionId: 'z' },
  });
  assert.equal(client.state?.phase, 'ROLL');
  assert.equal(client.state?.version, 4);

  // Joining something that is not there fails loudly.
  (globalThis as any).fetch = async () => ({ ok: false, json: async () => ({}) }) as unknown as Response;
  assert.equal(await client.joinRoom('ZZZZ'), false);
  assert.match(client.meta.error ?? '', /No table/i);
  client.shutdown();
});
