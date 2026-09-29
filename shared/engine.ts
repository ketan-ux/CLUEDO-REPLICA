/**
 * Authoritative game engine.
 *
 * Pure reducer: `reduce(state, action) -> result`. It runs identically on the
 * host (server) and inside the unit tests. Private information lives only here;
 * `mask()` strips it before anything is sent to a client.
 */
import {
  BOT_NAMES,
  CARDS,
  CARD_BY_ID,
  NOTEBOOK_ITEMS,
  ROOMS,
  SUSPECTS,
  SUSPECT_BY_ID,
  WEAPONS,
  WEAPON_BY_ID,
  itemIdOf,
} from './constants.js';
import {
  SPAWNS,
  buildOccupancy,
  doorsOf,
  hallKey,
  keyOfPos,
  reachable,
  pathToRoom,
  roomKey,
  roomName,
  secretPassageTarget,
  travelPath,
} from './board.js';
import type {
  Action,
  ActionResult,
  AnimEvent,
  CardKind,
  EngineEvent,
  GameState,
  LogEntry,
  ModalPayload,
  NotebookStamp,
  Phase,
  PlayerState,
  Position,
  PublicPlayer,
  QueryRecord,
  SuggestionRecord,
} from './types.js';

/* ------------------------------------------------------------------ */
/* Utility                                                             */
/* ------------------------------------------------------------------ */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function roll2d6(rng: () => number): [number, number] {
  return [1 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 6)];
}

const now = () => Date.now();

/* ------------------------------------------------------------------ */
/* Construction                                                        */
/* ------------------------------------------------------------------ */

export interface SeatSpec {
  id: string;
  name: string;
  suspectId: string;
  isBot: boolean;
}

export function createLobby(code: string, seed = Math.floor(Math.random() * 1e9)): GameState {
  return {
    code,
    createdAt: now(),
    phase: 'LOBBY',
    turn: 0,
    startedAt: null,
    players: [],
    turnIndex: 0,
    dice: null,
    diceRolledAt: null,
    moveSource: null,
    legalMoves: [],
    weaponLocations: Object.fromEntries(WEAPONS.map((w) => [w.id, w.startRoom])),
    suspectRooms: {},
    envelope: [],
    suggestion: null,
    pendingPrompt: null,
    queries: [],
    modals: [],
    dismissed: {},
    log: [],
    winnerId: null,
    solvable: true,
    rngSeed: seed,
    version: 0,
    animSeq: 0,
    animations: [],
    reveals: [],
    seq: 0,
  };
}

export function startGame(state: GameState, seed = state.rngSeed): GameState {
  const rng = mulberry32(seed >>> 0);
  const s: GameState = structuredClone(state);
  s.rngSeed = seed;
  s.phase = 'ROLL';
  s.turn = 1;
  s.startedAt = now();

  // Seat order is the authentic clockwise order: Miss Scarlet always first.
  s.players.sort(
    (a, b) => SUSPECTS.findIndex((x) => x.id === a.suspectId) - SUSPECTS.findIndex((x) => x.id === b.suspectId),
  );
  s.players.forEach((p, i) => {
    p.seat = i;
    p.pos = structuredClone(SPAWNS[p.suspectId]);
    p.eliminated = false;
    p.notebook = {};
    p.notes = p.notes ?? '';
    p.seenCards = [];
  });

  // 1. Seal the confidential envelope: one suspect, one weapon, one room.
  const suspectCards = CARDS.filter((c) => c.kind === 'suspect').map((c) => c.id);
  const weaponCards = CARDS.filter((c) => c.kind === 'weapon').map((c) => c.id);
  const roomCards = CARDS.filter((c) => c.kind === 'room').map((c) => c.id);
  s.envelope = [shuffle(suspectCards, rng)[0], shuffle(weaponCards, rng)[0], shuffle(roomCards, rng)[0]];

  // 2. Shuffle what remains and deal it out as evenly as the rules allow.
  const deck = shuffle(
    CARDS.map((c) => c.id).filter((id) => !s.envelope.includes(id)),
    rng,
  );
  for (const p of s.players) p.hand = [];
  deck.forEach((cardId, i) => {
    const receiver = s.players[i % s.players.length];
    receiver.hand.push(cardId);
    receiver.cardCount = receiver.hand.length;
  });
  for (const p of s.players) {
    p.cardCount = p.hand.length;
    for (const cardId of p.hand) {
      p.notebook[itemIdOf(cardId)] = 'cleared';
      p.seenCards.push(cardId);
    }
  }

  // 3. Reveal the player's own hand, one private dossier at a time.
  for (const p of s.players) {
    addModal(s, 'deal', p.id, {
      hand: [...p.hand],
      title: 'Your Confidential Hand',
      text: `${p.hand.length} cards were slipped under your door.`,
    });
  }

  pushLog(s, {
    kind: 'deal',
    text: `The cards are dealt. ${s.players.length} detectives at the table — ${s.players
      .map((p) => `${p.name} (${p.hand.length})`)
      .join(', ')}.`,
    tone: 'gold',
  });
  pushLog(s, {
    kind: 'system',
    text: `The confidential envelope is sealed. Miss Scarlet moves first.`,
    tone: 'neutral',
  });
  s.turnIndex = 0;
  ensureTurn(s);
  return s;
}

/* ------------------------------------------------------------------ */
/* Logging, modals, animation                                          */
/* ------------------------------------------------------------------ */

type LogInput = Omit<LogEntry, 'id' | 'turn' | 't' | 'visibleTo'> & { visibleTo?: string | null };

function pushLog(s: GameState, entry: LogInput): void {
  s.log.push({ id: `l${++s.seq}`, turn: s.turn, t: now(), visibleTo: null, ...entry });
  if (s.log.length > 220) s.log.splice(0, s.log.length - 220);
}

export function addModal(
  s: GameState,
  kind: ModalPayload['kind'],
  forPlayerId: string | null,
  data: Record<string, unknown>,
): string {
  const id = `m${++s.seq}`;
  s.modals.push({ id, kind, forPlayerId, data });
  if (s.modals.length > 40) s.modals.splice(0, s.modals.length - 40);
  return id;
}

function addAnim(s: GameState, type: AnimEvent['type'], id: string, path: Position[]): void {
  s.animations.push({ seq: ++s.animSeq, type, id, path, at: now() });
  if (s.animations.length > 16) s.animations.splice(0, s.animations.length - 16);
}

function touch(s: GameState): void {
  s.version++;
}

export function playerById(s: GameState, id: string): PlayerState | undefined {
  return s.players.find((p) => p.id === id);
}

export function turnPlayer(s: GameState): PlayerState | undefined {
  return s.players[s.turnIndex];
}

function alivePlayers(s: GameState): PlayerState[] {
  return s.players.filter((p) => !p.eliminated);
}

function err(error: string): ActionResult {
  return { ok: false, error };
}

function ok(state: GameState, events: EngineEvent[] = []): ActionResult {
  touch(state);
  return { ok: true, state, events };
}

/* ------------------------------------------------------------------ */
/* Moves                                                              */
/* ------------------------------------------------------------------ */

function occupancyFor(s: GameState, moverId: string) {
  return buildOccupancy(
    s.players.map((p) => ({ id: p.id, pos: p.pos, eliminated: p.eliminated })),
    moverId,
  );
}

function computeLegalMoves(s: GameState, player: PlayerState, steps: number, source: 'dice' | 'passage'): void {
  if (source === 'passage') {
    const dest = secretPassageTarget(player.pos.kind === 'room' ? player.pos.roomId : '');
    s.legalMoves = dest ? [{ key: roomKey(dest), pos: { kind: 'room', roomId: dest }, dist: 0, path: [] }] : [];
    return;
  }
  const occ = occupancyFor(s, player.id);
  const options = reachable(player.pos, steps, occ);
  // A detective already inside a room may always choose to stay and interrogate.
  if (player.pos.kind === 'room' && !options.some((o) => o.pos.kind === 'room' && o.pos.roomId === (player.pos as any).roomId)) {
    options.unshift({
      key: keyOfPos(player.pos),
      pos: { ...player.pos },
      dist: 0,
      path: [],
      stay: true,
    });
  }
  s.legalMoves = options.map((o) => ({ key: o.key, pos: o.pos, dist: o.dist, path: o.path }));
}

function ensureTurn(s: GameState): void {
  const p = turnPlayer(s);
  if (!p || s.phase === 'GAME_OVER') return;
  if (p.eliminated) {
    advanceTurn(s);
    return;
  }
  s.phase = 'ROLL';
  s.dice = null;
  s.diceRolledAt = null;
  s.moveSource = null;
  s.legalMoves = [];
  s.suggestion = null;
  s.pendingPrompt = null;
}

function advanceTurn(s: GameState): void {
  if (s.phase === 'GAME_OVER') return;
  const remaining = alivePlayers(s);
  if (remaining.length <= 1 && remaining.length > 0) {
    // Walkover: every other detective has been shown the door.
    const winner = remaining[0];
    s.winnerId = winner.id;
    s.phase = 'GAME_OVER';
    pushLog(s, {
      kind: 'win',
      text: `${winner.name} stands alone — the last detective in the mansion. Case closed by walkover.`,
      tone: 'gold',
    });
    addModal(s, 'solved', null, {
      winnerId: winner.id,
      winnerName: winner.name,
      walkover: true,
      envelope: [...s.envelope],
    });
    ensureWinnerHandDelivered(s, winner.id);
    return;
  }
  let guard = 0;
  do {
    s.turnIndex = (s.turnIndex + 1) % s.players.length;
    guard++;
  } while (s.players[s.turnIndex].eliminated && guard < s.players.length * 2);
  s.turn++;
  ensureTurn(s);
}

function ensureWinnerHandDelivered(s: GameState, winnerId: string): void {
  const winner = playerById(s, winnerId);
  if (winner) {
    pushLog(s, {
      kind: 'reveal',
      text: `The envelope is opened: ${s.envelope
        .map((c) => CARD_BY_ID[c]?.name)
        .join(' · ')}.`,
      tone: 'gold',
      visibleTo: winnerId,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Suggestions & the clockwise disproval query                          */
/* ------------------------------------------------------------------ */

/** Everyone else, clockwise from the suggester's left. */
export function queryOrder(s: GameState, suggesterId: string): PlayerState[] {
  const start = s.players.findIndex((p) => p.id === suggesterId);
  const order: PlayerState[] = [];
  for (let i = 1; i < s.players.length; i++) {
    order.push(s.players[(start + i) % s.players.length]);
  }
  return order;
}

function beginSuggestion(
  s: GameState,
  suggester: PlayerState,
  suspectId: string,
  weaponId: string,
): EngineEvent[] {
  const roomId = suggester.pos.kind === 'room' ? suggester.pos.roomId : null;
  if (!roomId) return [];
  const cards = [`s:${suspectId}`, `w:${weaponId}`, `r:${roomId}`];

  // The named suspect and the weapon are paraded into the room. If that suspect
  // is a detective at this table, it is their pawn that walks in — everybody can
  // see it happen, and it stays there until they move again.
  const named = s.players.find((p) => p.suspectId === suspectId && !p.eliminated);
  s.suspectRooms[suspectId] = roomId;
  if (named && named.id !== suggester.id) {
    const from = named.pos;
    if (!(from.kind === 'room' && from.roomId === roomId)) {
      const path = pathToRoom(from, roomId);
      named.pos = { kind: 'room', roomId, doorId: path[path.length - 1].kind === 'room' ? (path[path.length - 1] as any).doorId : undefined };
      addAnim(s, 'pawn', named.id, path);
      pushLog(s, {
        kind: 'suggest',
        text: `${named.name}'s pawn (${SUSPECT_BY_ID[suspectId]?.name}) is summoned into the ${roomName(roomId)}.`,
        tone: 'blue',
      });
    }
  }
  const weaponFrom = s.weaponLocations[weaponId];
  s.weaponLocations[weaponId] = roomId;
  if (weaponFrom !== roomId) addAnim(s, 'weapon', weaponId, travelPath(weaponFrom, roomId));

  const query: QueryRecord = {
    id: `q${++s.seq}`,
    turn: s.turn,
    suggesterId: suggester.id,
    suspectId,
    weaponId,
    roomId,
    queried: [],
    passed: [],
    disproverId: null,
    unrefuted: false,
    cards: [...cards],
  };
  s.queries.push(query);
  if (s.queries.length > 120) s.queries.splice(0, s.queries.length - 120);

  const rec: SuggestionRecord = {
    id: query.id,
    turn: s.turn,
    suggesterId: suggester.id,
    suspectId,
    weaponId,
    roomId,
    disproverId: null,
    revealedCardId: null,
    unrefuted: false,
  };
  s.suggestion = rec;

  pushLog(s, {
    kind: 'suggest',
    text: `${suggester.name} suggests the crime was committed by ${SUSPECT_BY_ID[suspectId]?.name} with the ${WEAPON_BY_ID[weaponId]?.name} in the ${roomName(roomId)}.`,
    tone: 'blood',
  });

  // Clockwise query, beginning with the player to the suggester's left.
  for (const queried of queryOrder(s, suggester.id)) {
    query.queried.push(queried.id);
    const matching = queried.hand.filter((c) => cards.includes(c));
    if (matching.length > 0) {
      query.disproverId = queried.id;
      s.pendingPrompt = {
        id: `p${++s.seq}`,
        playerId: queried.id,
        suggesterId: suggester.id,
        suspectId,
        weaponId,
        roomId,
        options: matching,
      };
      s.phase = 'DISPROVE';
      pushLog(s, {
        kind: 'system',
        text: `${queried.name} is examining their cards…`,
        tone: 'neutral',
        visibleTo: null,
      });
      return [{ type: 'wait', ms: 900, forPlayerId: queried.id, hint: 'disprove' }];
    }
    query.passed.push(queried.id);
    pushLog(s, {
      kind: 'system',
      text: `${queried.name} holds none of those cards and passes.`,
      tone: 'neutral',
    });
  }

  // Nobody could refute the theory.
  return unrefutedBreakthrough(s, suggester, rec);
}

function unrefutedBreakthrough(s: GameState, suggester: PlayerState, rec: SuggestionRecord): EngineEvent[] {
  rec.unrefuted = true;
  const q = s.queries.find((x) => x.id === rec.id);
  if (q) q.unrefuted = true;
  const cards = [`s:${rec.suspectId}`, `w:${rec.weaponId}`, `r:${rec.roomId}`];
  const foreign = cards.filter((c) => !suggester.hand.includes(c));
  const deduced = foreign.length === 3;
  pushLog(s, {
    kind: 'unrefuted',
    text: `Unrefuted! ${suggester.name}'s theory could not be disproved by any detective.`,
    tone: 'gold',
  });
  addModal(s, 'unrefuted', suggester.id, {
    suggestion: { ...rec },
    cards: foreign,
    certain: deduced,
    text: deduced
      ? 'Nobody could touch your theory — and none of those three cards are in your own hand. All three are inside the confidential envelope. You may accuse at once.'
      : 'Nobody was able to disprove your theory. Any of these cards not in your own hand MUST be in the murder envelope.',
  });
  if (deduced) {
    suggester.accusationReady = { ...rec };
  }
  s.phase = 'ACCUSE';
  return [{ type: 'wait', ms: 700, forPlayerId: suggester.id, hint: 'accuse' }];
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

export function reduce(state: GameState, action: Action): ActionResult {
  const s: GameState = structuredClone(state);
  const actor = 'playerId' in action ? playerById(s, action.playerId) : undefined;

  switch (action.type) {
    case 'START_GAME': {
      if (s.phase !== 'LOBBY') return err('The game has already begun.');
      if (actor && !actor.isHost) return err('Only the host may deal the cards.');
      if (s.players.length < 2) return err('A séance needs at least two detectives.');
      const started = startGame(s);
      return ok(started);
    }

    case 'CLAIM_SEAT': {
      if (s.phase !== 'LOBBY') return err('Seats are locked once the game starts.');
      const taken = new Set(s.players.filter((p) => p.id !== action.playerId).map((p) => p.suspectId));
      const wanted = action.suspectId && !taken.has(action.suspectId) ? action.suspectId : nextFreeSeat(s, action.playerId);
      if (!wanted) return err('Every suspect is already seated.');
      const label = (action.name ?? actor?.name ?? 'Detective').slice(0, 22);
      if (actor) {
        actor.suspectId = wanted;
        actor.name = label;
        actor.pos = structuredClone(SPAWNS[wanted]);
      } else {
        if (s.players.length >= 6) return err('The table is full — six suspects only.');
        const p = makePlayer(s, action.playerId, label, wanted, false);
        p.isHost = false;
        s.players.push(p);
      }
      return ok(s);
    }

    case 'ADD_BOT': {
      if (s.phase !== 'LOBBY') return err('Seats are locked once the game starts.');
      if (actor && !actor.isHost) return err('Only the host may seat a bot.');
      if (s.players.length >= 6) return err('The table is full — six suspects only.');
      const taken = new Set(s.players.map((p) => p.suspectId));
      const free = SUSPECTS.filter((x) => !taken.has(x.id));
      if (free.length === 0) return err('Every suspect is already seated.');
      const suspect = action.suspectId && !taken.has(action.suspectId)
        ? free.find((f) => f.id === action.suspectId) ?? free[0]
        : free[0];
      const usedNames = new Set(s.players.map((p) => p.name));
      const name = action.name ?? BOT_NAMES.find((n) => !usedNames.has(n)) ?? `Inspector ${s.players.length + 1}`;
      s.players.push(makePlayer(s, `bot-${suspect.id}-${++s.seq}`, name, suspect.id, true));
      pushLog(s, { kind: 'system', text: `${name} (${suspect.name}) takes a seat at the table.`, tone: 'neutral' });
      return ok(s);
    }

    case 'REMOVE_PLAYER': {
      if (s.phase !== 'LOBBY') return err('Seats are locked once the game starts.');
      if (actor && !actor.isHost && actor.id !== action.targetId) return err('Only the host may remove a detective.');
      const target = playerById(s, action.targetId);
      if (!target) return err('No such detective.');
      s.players = s.players.filter((p) => p.id !== action.targetId);
      if (target.isHost && s.players.length) s.players[0].isHost = true;
      pushLog(s, { kind: 'system', text: `${target.name} left the table.`, tone: 'neutral' });
      return ok(s);
    }

    case 'ROLL': {
      if (!actor) return err('Unknown detective.');
      if (s.phase !== 'ROLL') return err('It is not time to roll.');
      if (turnPlayer(s)?.id !== actor.id) return err('Not your turn.');
      const rng = mulberry32((s.rngSeed + s.turn * 7919 + s.version * 104729) >>> 0);
      const dice = roll2d6(rng);
      s.dice = dice;
      s.diceRolledAt = now();
      s.moveSource = 'dice';
      s.phase = 'MOVE';
      computeLegalMoves(s, actor, dice[0] + dice[1], 'dice');
      pushLog(s, {
        kind: 'roll',
        text: `${actor.name} rolls the dice — ${dice[0]} and ${dice[1]} for ${dice[0] + dice[1]} pips.`,
        tone: 'gold',
      });
      if (s.legalMoves.length === 0) {
        pushLog(s, {
          kind: 'system',
          text: `Every corridor out of ${actor.name}'s position is blocked — the move is forfeit.`,
          tone: 'neutral',
        });
        s.phase = actor.pos.kind === 'room' ? 'SUGGEST' : 'ACCUSE';
      }
      return ok(s);
    }

    case 'SECRET_PASSAGE': {
      if (!actor) return err('Unknown detective.');
      if (s.phase !== 'ROLL') return err('The passage may only be taken instead of rolling.');
      if (turnPlayer(s)?.id !== actor.id) return err('Not your turn.');
      if (actor.pos.kind !== 'room') return err('You must be inside a room to use a passage.');
      const dest = secretPassageTarget(actor.pos.roomId);
      if (!dest) return err('This room has no secret passage.');
      const path = travelPath(actor.pos.roomId, dest);
      actor.pos = { kind: 'room', roomId: dest };
      s.moveSource = 'passage';
      s.dice = null;
      s.legalMoves = [];
      addAnim(s, 'pawn', actor.id, path);
      pushLog(s, {
        kind: 'passage',
        text: `${actor.name} slips through the secret passage into the ${roomName(dest)}.`,
        tone: 'blue',
      });
      s.phase = 'SUGGEST';
      return ok(s);
    }

    case 'MOVE': {
      if (!actor) return err('Unknown detective.');
      if (s.phase !== 'MOVE') return err('Not the time to move.');
      if (turnPlayer(s)?.id !== actor.id) return err('Not your turn.');
      const option = s.legalMoves.find((m) => keyOfPos(m.pos) === keyOfPos(action.to));
      if (!option) return err('That space is out of reach.');
      const from = actor.pos;
      actor.pos = { ...option.pos };
      addAnim(s, 'pawn', actor.id, [from, ...option.path.slice(1)]);
      const destKey = option.pos.kind === 'room' ? roomName(option.pos.roomId) : 'the corridor';
      pushLog(s, {
        kind: 'move',
        text: `${actor.name} moves ${option.dist} ${option.dist === 1 ? 'pip' : 'pips'} into ${destKey}.`,
        tone: 'neutral',
      });
      s.phase = option.pos.kind === 'room' ? 'SUGGEST' : 'ACCUSE';
      s.legalMoves = [];
      return ok(s);
    }

    case 'SUGGEST': {
      if (!actor) return err('Unknown detective.');
      if (s.phase !== 'SUGGEST') return err('A theory may only be proposed from inside a room.');
      if (turnPlayer(s)?.id !== actor.id) return err('Not your turn.');
      if (actor.pos.kind !== 'room') return err('You must be inside a room to make a suggestion.');
      if (!SUSPECT_BY_ID[action.suspectId]) return err('Unknown suspect.');
      if (!WEAPON_BY_ID[action.weaponId]) return err('Unknown weapon.');
      const events = beginSuggestion(s, actor, action.suspectId, action.weaponId);
      return ok(s, events);
    }

    case 'SKIP_SUGGEST': {
      if (!actor) return err('Unknown detective.');
      if (s.phase !== 'SUGGEST') return err('Nothing to skip.');
      if (turnPlayer(s)?.id !== actor.id) return err('Not your turn.');
      pushLog(s, { kind: 'system', text: `${actor.name} keeps their theory to themselves.`, tone: 'neutral' });
      s.phase = 'ACCUSE';
      return ok(s);
    }

    case 'DISPROVE': {
      if (!actor) return err('Unknown detective.');
      if (s.phase !== 'DISPROVE' || !s.pendingPrompt) return err('No theory is awaiting your answer.');
      const prompt = s.pendingPrompt;
      if (prompt.id !== action.promptId) return err('That query has already been settled.');
      if (prompt.playerId !== actor.id) return err('The query is not addressed to you.');

      let revealed = action.cardId;
      if (revealed === null) {
        // "I cannot disprove" — only legal if the queried player truly holds nothing.
        if (prompt.options.length > 0) return err('You must show one of your matching cards.');
        revealed = null;
      } else if (!prompt.options.includes(revealed)) {
        return err('You do not hold that card.');
      }

      const suggester = playerById(s, prompt.suggesterId);
      const cardId = revealed as string;
      if (s.suggestion) {
        s.suggestion.disproverId = actor.id;
        s.suggestion.revealedCardId = cardId;
      }
      s.reveals.push({
        cardId,
        byId: actor.id,
        toId: prompt.suggesterId,
        suggestionId: s.suggestion?.id ?? '',
        turn: s.turn,
      });
      if (s.reveals.length > 200) s.reveals.splice(0, s.reveals.length - 200);

      // Private knowledge: the suggester and the disprover both learn the card.
      if (suggester) {
        suggester.notebook[itemIdOf(cardId)] = 'cleared';
        if (!suggester.seenCards.includes(cardId)) suggester.seenCards.push(cardId);
      }
      actor.notebook[itemIdOf(cardId)] = 'cleared';
      if (!actor.seenCards.includes(cardId)) actor.seenCards.push(cardId);

      pushLog(s, {
        kind: 'disprove',
        text: `${actor.name} proved the theory false to ${suggester?.name ?? 'the suggester'} — one card shown in private.`,
        tone: 'green',
      });
      pushLog(s, {
        kind: 'disprove',
        text: `You showed the ${CARD_BY_ID[cardId]?.name} to ${suggester?.name}.`,
        tone: 'green',
        visibleTo: actor.id,
      });
      pushLog(s, {
        kind: 'disprove',
        text: `${actor.name} slid the ${CARD_BY_ID[cardId]?.name} across the table to you.`,
        tone: 'gold',
        visibleTo: prompt.suggesterId,
      });

      s.pendingPrompt = null;
      s.phase = 'ACCUSE';
      return ok(s, [
        { type: 'sfx', name: 'reveal' },
        { type: 'wait', ms: 900, forPlayerId: prompt.suggesterId, hint: 'accuse' },
      ]);
    }

    case 'ACCUSE': {
      if (!actor) return err('Unknown detective.');
      if (s.phase !== 'ACCUSE') return err('This is not the moment for a final accusation.');
      if (turnPlayer(s)?.id !== actor.id) return err('Only the detective whose turn it is may accuse.');
      if (actor.eliminated) return err('You have already been eliminated.');
      const acc = [`s:${action.suspectId}`, `w:${action.weaponId}`, `r:${action.roomId}`];
      if (!SUSPECT_BY_ID[action.suspectId] || !WEAPON_BY_ID[action.weaponId] || !ROOMS.find((r) => r.id === action.roomId)) {
        return err('Incomplete accusation.');
      }
      const correct = acc.every((c) => s.envelope.includes(c));
      pushLog(s, {
        kind: 'accuse',
        text: `${actor.name} makes a FINAL ACCUSATION: ${SUSPECT_BY_ID[action.suspectId]?.name}, with the ${
          WEAPON_BY_ID[action.weaponId]?.name
        }, in the ${roomName(action.roomId)}.`,
        tone: 'blood',
      });
      if (correct) {
        s.winnerId = actor.id;
        s.phase = 'GAME_OVER';
        pushLog(s, {
          kind: 'win',
          text: `The accusation is TRUE. ${actor.name} has solved the murder!`,
          tone: 'gold',
        });
        addModal(s, 'solved', null, {
          winnerId: actor.id,
          winnerName: actor.name,
          envelope: [...s.envelope],
          accusation: acc,
          text: 'The three sealed folders are opened before the assembled company…',
        });
        ensureWinnerHandDelivered(s, actor.id);
      } else {
        actor.eliminated = true;
        actor.eliminatedOnTurn = s.turn;
        pushLog(s, {
          kind: 'eliminate',
          text: `${actor.name} was wrong. The evidence is incontrovertible — they are escorted out and become a witness only.`,
          tone: 'blood',
        });
        addModal(s, 'eliminated', actor.id, {
          accusation: acc,
          text: 'Your accusation was false. You may no longer roll, move or suggest — but your cards remain in play and you must still answer other detectives\u2019 questions.',
        });
        s.phase = 'END_TURN';
        advanceTurn(s);
      }
      return ok(s, [{ type: 'sfx', name: correct ? 'win' : 'gavel' }]);
    }

    case 'SKIP_ACCUSE': {
      if (!actor) return err('Unknown detective.');
      if (s.phase !== 'ACCUSE') return err('Nothing to decline.');
      if (turnPlayer(s)?.id !== actor.id) return err('Not your turn.');
      s.phase = 'END_TURN';
      return ok(s);
    }

    case 'END_TURN': {
      if (!actor) return err('Unknown detective.');
      if (s.phase !== 'END_TURN' && s.phase !== 'ACCUSE' && s.phase !== 'SUGGEST') return err('The turn cannot end yet.');
      if (turnPlayer(s)?.id !== actor.id) return err('Not your turn.');
      advanceTurn(s);
      return ok(s, [{ type: 'turnChanged', playerId: turnPlayer(s)?.id ?? '' }]);
    }

    case 'DISMISS_MODAL': {
      if (!actor) return err('Unknown detective.');
      const list = s.dismissed[actor.id] ?? [];
      if (!list.includes(action.modalId)) list.push(action.modalId);
      s.dismissed[actor.id] = list;
      return ok(s);
    }

    case 'SET_NOTE': {
      if (!actor) return err('Unknown detective.');
      const known = [
        ...NOTEBOOK_ITEMS.suspect,
        ...NOTEBOOK_ITEMS.weapon,
        ...NOTEBOOK_ITEMS.room,
      ];
      if (!known.includes(action.item)) return err('Unknown notebook entry.');
      if (!['unknown', 'cleared', 'suspected', 'ruled'].includes(action.stamp)) {
        return err('Unknown notebook stamp.');
      }
      actor.notebook[action.item] = action.stamp;
      return ok(s);
    }

    case 'SET_SCRATCH': {
      if (!actor) return err('Unknown detective.');
      actor.notes = String(action.text ?? '').slice(0, 4000);
      return ok(s);
    }

    case 'REMATCH': {
      if (!actor?.isHost) return err('Only the host may call for a new investigation.');
      const fresh = createLobby(s.code, Math.floor(Math.random() * 1e9));
      fresh.players = s.players.map((p) => ({
        ...makePlayer(fresh, p.id, p.name, p.suspectId, p.isBot),
        isHost: p.isHost,
        notes: '',
      }));
      fresh.log = [];
      return ok(startGame(fresh), [{ type: 'sfx', name: 'shuffle' }]);
    }

    default:
      return err('Unhandled action.');
  }
}

function nextFreeSeat(s: GameState, excludeId: string): string | null {
  const taken = new Set(s.players.filter((p) => p.id !== excludeId).map((p) => p.suspectId));
  return SUSPECTS.find((x) => !taken.has(x.id))?.id ?? null;
}

function makePlayer(s: GameState, id: string, name: string, suspectId: string, isBot: boolean): PlayerState {
  return {
    id,
    name,
    suspectId,
    isBot,
    connected: true,
    isHost: false,
    eliminated: false,
    pos: structuredClone(SPAWNS[suspectId]),
    cardCount: 0,
    seat: s.players.length,
    hand: [],
    notebook: {},
    notes: '',
    seenCards: [],
  };
}

/* ------------------------------------------------------------------ */
/* Host helpers                                                        */
/* ------------------------------------------------------------------ */

export function addHuman(
  state: GameState,
  id: string,
  name: string,
  suspectId: string,
  isHost: boolean,
): GameState {
  const s = structuredClone(state);
  if (s.players.length >= 6) return s;
  const taken = new Set(s.players.map((p) => p.suspectId));
  const chosen = taken.has(suspectId) ? SUSPECTS.find((x) => !taken.has(x.id))?.id ?? suspectId : suspectId;
  const p = makePlayer(s, id, name, chosen, false);
  p.isHost = isHost;
  s.players.push(p);
  pushLog(s, { kind: 'system', text: `${name} has arrived.`, tone: 'neutral' });
  return s;
}

export function eligibleAccusationReady(s: GameState, playerId: string): boolean {
  const p = playerById(s, playerId);
  return !!p && !!p.accusationReady && !p.eliminated;
}

/* ------------------------------------------------------------------ */
/* Masking — the anti-cheat boundary                                    */
/* ------------------------------------------------------------------ */

export interface RevealRecord {
  cardId: string;
  byId: string;
  toId: string;
  suggestionId: string;
  turn: number;
}

const MODAL_PRIORITY: Record<ModalPayload['kind'], number> = {
  solved: 100,
  eliminated: 80,
  unrefuted: 60,
  deal: 20,
};

export function maskState(s: GameState, viewerId: string): import('./types.js').MaskedState {
  const viewer = playerById(s, viewerId);
  const revealedToViewer = (r: RevealRecord) => r.byId === viewerId || r.toId === viewerId;

  const players: PublicPlayer[] = s.players.map((p) => ({
    id: p.id,
    name: p.name,
    suspectId: p.suspectId,
    isBot: p.isBot,
    connected: p.connected,
    isHost: p.isHost,
    eliminated: p.eliminated,
    eliminatedOnTurn: p.eliminatedOnTurn,
    pos: p.pos,
    cardCount: p.hand.length,
    seat: p.seat,
  }));

  const gameOver = s.phase === 'GAME_OVER';
  const dismissed = new Set(s.dismissed[viewerId] ?? []);

  return {
    code: s.code,
    phase: s.phase,
    turn: s.turn,
    turnIndex: s.turnIndex,
    players,
    you: viewerId,
    isHost: !!viewer?.isHost,
    dice: s.dice,
    moveSource: s.moveSource,
    legalMoves:
      turnPlayer(s)?.id === viewerId ? s.legalMoves.map((m) => ({ ...m })) : [],
    weaponLocations: { ...s.weaponLocations },
    suspectRooms: { ...s.suspectRooms },
    hand: viewer ? [...viewer.hand] : [],
    notebook: viewer ? { ...viewer.notebook } : {},
    notes: viewer?.notes ?? '',
    cardCounts: Object.fromEntries(s.players.map((p) => [p.id, p.hand.length])),
    suggestion: s.suggestion
      ? {
          ...s.suggestion,
          // The card itself is private: only the suggester and the disprover see it.
          revealedCardId:
            viewerId === s.suggestion.suggesterId || viewerId === s.suggestion.disproverId
              ? s.suggestion.revealedCardId
              : null,
        }
      : null,
    queries: s.queries.map((q) => ({ ...q, cards: [...q.cards], passed: [...q.passed], queried: [...q.queried] })),
    prompt:
      s.pendingPrompt && s.pendingPrompt.playerId === viewerId
        ? { ...s.pendingPrompt, options: [...s.pendingPrompt.options] }
        : null,
    reveals: s.reveals.filter(revealedToViewer).map((r) => ({ ...r })),
    // Dramatic reveals always outrank the paperwork: a player who has not yet
    // closed their dealt hand must still see the case crack open.
    modals: s.modals
      .filter((m) => !dismissed.has(m.id) && (m.forPlayerId === null || m.forPlayerId === viewerId))
      .sort((a, b) => MODAL_PRIORITY[b.kind] - MODAL_PRIORITY[a.kind]),
    log: s.log.filter((l) => l.visibleTo === null || l.visibleTo === viewerId),
    envelope: gameOver ? [...s.envelope] : null,
    winnerId: s.winnerId,
    startedAt: s.startedAt,
    version: s.version,
    animations: s.animations.slice(-12).map((a) => ({ ...a })),
    turnPlayerId: turnPlayer(s)?.id ?? null,
    passageRoomId:
      s.phase === 'ROLL' && turnPlayer(s)?.id === viewerId && viewer?.pos.kind === 'room'
        ? secretPassageTarget(viewer.pos.roomId) ?? null
        : null,
    accusationReady:
      viewer && s.phase === 'ACCUSE' && turnPlayer(s)?.id === viewerId && viewer.accusationReady
        ? { ...viewer.accusationReady }
        : null,
  };
}

export { doorsOf, hallKey, travelPath };
