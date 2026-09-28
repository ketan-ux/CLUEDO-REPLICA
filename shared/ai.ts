/**
 * Autonomous AI detectives.
 *
 * Each bot is a *fair* player: it only ever reasons from information a human in
 * its seat could see (its own hand, cards shown to it, and what happens publicly
 * at the table). The host drives them with a 800–1200 ms cadence so human players
 * can watch every roll, step, suggestion and disproval land in real time.
 */
import {
  ROOMS,
  SUSPECTS,
  WEAPONS,
  itemIdOf,
  WEAPON_BY_ID,
} from './constants.js';
import { DOOR_BY_OUT, doorwayFlood, hallKey, nearestRoomPips, secretPassageTarget } from './board.js';
import { knowledgeFor, type Knowledge } from './deduction.js';
import type { Action, CardKind, GameState, PlayerState, Position } from './types.js';

/* ------------------------------------------------------------------ */
/* Suggestion memory (public information only)                          */
/* ------------------------------------------------------------------ */

interface SuggestionMemory {
  /** How often each item has already been suggested at this table. */
  itemCount: Map<string, number>;
  /** Trios this bot has already put to the table — repeating them wastes a turn. */
  askedByBot: Set<string>;
}

function memoryOf(state: GameState, botId: string): SuggestionMemory {
  const itemCount = new Map<string, number>();
  const askedByBot = new Set<string>();
  for (const q of state.queries) {
    for (const cardId of q.cards) {
      const item = itemIdOf(cardId);
      itemCount.set(item, (itemCount.get(item) ?? 0) + 1);
    }
    if (q.suggesterId === botId) {
      askedByBot.add(`${q.suspectId}|${q.weaponId}|${q.roomId}`);
    }
  }
  return { itemCount, askedByBot };
}

/* ------------------------------------------------------------------ */
/* Movement                                                            */
/* ------------------------------------------------------------------ */

interface ScoredMove {
  key: string;
  pos: Position;
  dist: number;
  score: number;
  stay?: boolean;
  path: Position[];
}

/**
 * Goal-driven move selection: head for the doorway of a room whose card is still
 * unaccounted for, take a room whenever it holds new information, and keep a
 * hallway tile that leaves a doorway within reach of the next roll.
 */
export function chooseMove(state: GameState, bot: PlayerState, k: Knowledge): Action | null {
  const legal = state.legalMoves;
  if (!legal.length) return null;

  // Rooms that could still hide the crime scene.
  const targetRooms = ROOMS.filter((r) => k.candidates.room.includes(r.id));
  const inRoom = bot.pos.kind === 'room' ? bot.pos.roomId : null;
  // One reverse flood answers "pips to the nearest unexplored room" for every
  // tile on the board, so scoring thirty candidate moves costs a single pass.
  const flood = doorwayFlood(targetRooms.map((r) => r.id), 34);

  const scored: ScoredMove[] = legal.map((m) => {
    const dist = m.dist;
    let score: number;

    if (m.stay) {
      // Remaining inside an unexplored room keeps the interrogation going.
      const target = inRoom && k.candidates.room.includes(inRoom);
      score = target ? 880 : 360;
    } else if (m.pos.kind === 'room') {
      const isTarget = k.candidates.room.includes(m.pos.roomId);
      const roomCard = `r:${m.pos.roomId}`;
      const fresh = !k.seen.has(roomCard);
      score = isTarget ? 900 - dist : fresh ? 520 - dist : 300 - dist;
    } else {
      // Hallway: walk towards the nearest room that still needs investigating.
      const goal = nearestRoomPips(flood, m.pos);
      score = 640 - (Number.isFinite(goal) ? goal * 32 : 0) - dist * 4;
      if (DOOR_BY_OUT.has(hallKey(m.pos.x, m.pos.y))) score += 30; // ready to step inside
      if (targetRooms.length === 0) score = 200 - dist * 3;
    }

    // Mild entropy so two bots never shadow each other tile-for-tile.
    score += Math.random() * 6;
    return { key: m.key, pos: m.pos, dist, score, stay: m.stay, path: m.path };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  return { type: 'MOVE', playerId: bot.id, to: best.pos };
}

/* ------------------------------------------------------------------ */
/* Suggestions                                                         */
/* ------------------------------------------------------------------ */

/** Pick the suspect + weapon that promise the most new information right now. */
export function chooseSuggestion(
  state: GameState,
  bot: PlayerState,
  k: Knowledge,
): { suspectId: string; weaponId: string } | null {
  if (bot.pos.kind !== 'room') return null;
  const roomId = bot.pos.roomId;
  const mem = memoryOf(state, bot.id);

  const rank = (kind: CardKind, ids: string[]): string[] => {
    return [...ids].sort((a, b) => {
      const na = mem.itemCount.get(a) ?? 0;
      const nb = mem.itemCount.get(b) ?? 0;
      if (na !== nb) return na - nb; // never-asked items teach the most
      // Fewer remaining candidates in that category means more is already known,
      // so probing there tightens the net faster.
      const la = k.candidates[kind].indexOf(a);
      const lb = k.candidates[kind].indexOf(b);
      return la - lb;
    });
  };

  const fresh = (kind: CardKind, ids: string[]) => ids.filter((i) => !k.seen.has(`${prefixOf(kind)}:${i}`));

  const suspectPool = rank('suspect', fresh('suspect', k.candidates.suspect.length ? k.candidates.suspect : SUSPECTS.map((s) => s.id)));
  const weaponPool = rank('weapon', fresh('weapon', k.candidates.weapon.length ? k.candidates.weapon : WEAPONS.map((w) => w.id)));

  if (!suspectPool.length || !weaponPool.length) return null;

  // Avoid repeating a trio this bot has already put to the table unless there is
  // genuinely nothing else left to ask.
  for (const s of suspectPool) {
    for (const w of weaponPool) {
      if (!mem.askedByBot.has(`${s}|${w}|${roomId}`)) return { suspectId: s, weaponId: w };
    }
  }
  return { suspectId: suspectPool[0], weaponId: weaponPool[0] };
}

function prefixOf(kind: CardKind): string {
  return kind === 'suspect' ? 's' : kind === 'weapon' ? 'w' : 'r';
}

/* ------------------------------------------------------------------ */
/* Disproval                                                           */
/* ------------------------------------------------------------------ */

/**
 * Which of the matching cards should this detective slide across the table?
 * A card the whole table has already chewed on gives the least away.
 */
export function chooseReveal(state: GameState, playerId: string, options: string[]): string {
  if (options.length === 1) return options[0];
  const counts = new Map<string, number>();
  for (const q of state.queries) {
    for (const c of q.cards) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const kindWeight: Record<string, number> = { r: 0, w: 1, s: 2 }; // rooms leak least
  return [...options].sort((a, b) => {
    const ca = counts.get(a) ?? 0;
    const cb = counts.get(b) ?? 0;
    if (ca !== cb) return cb - ca;
    return kindWeight[a[0]] - kindWeight[b[0]];
  })[0];
}

/* ------------------------------------------------------------------ */
/* Accusations                                                         */
/* ------------------------------------------------------------------ */

/** Very late in the game a bot will gamble on the narrowest reading it has. */
const GAMBIT_TURN = 34;

export function chooseAccusation(
  state: GameState,
  bot: PlayerState,
  k: Knowledge,
): Action | null {
  const ready = bot.accusationReady;
  if (ready) {
    return {
      type: 'ACCUSE',
      playerId: bot.id,
      suspectId: ready.suspectId,
      weaponId: ready.weaponId,
      roomId: ready.roomId,
    };
  }
  if (k.solution) {
    return { type: 'ACCUSE', playerId: bot.id, ...k.solution };
  }
  if (state.turn >= GAMBIT_TURN) {
    // A desperate gambit: take the forced cards and guess the rest from the
    // narrowest candidate lists, rather than let the case go cold.
    const narrow: Partial<Record<CardKind, string>> = { ...k.certain };
    for (const kind of ['suspect', 'weapon', 'room'] as CardKind[]) {
      if (!narrow[kind] && k.candidates[kind].length === 1) narrow[kind] = k.candidates[kind][0];
    }
    const missing = (['suspect', 'weapon', 'room'] as CardKind[]).filter((kind) => !narrow[kind]);
    if (missing.length <= 1) {
      const pick = (kind: CardKind) => {
        if (narrow[kind]) return narrow[kind] as string;
        const pool = k.candidates[kind];
        return pool[Math.floor(Math.random() * pool.length)];
      };
      return {
        type: 'ACCUSE',
        playerId: bot.id,
        suspectId: pick('suspect'),
        weaponId: pick('weapon'),
        roomId: pick('room'),
      };
    }
  }
  return { type: 'SKIP_ACCUSE', playerId: bot.id };
}

/* ------------------------------------------------------------------ */
/* The brain                                                           */
/* ------------------------------------------------------------------ */

/**
 * Decide the bot's next action for the current phase. Returns `null` when the bot
 * has nothing to do (e.g. it is not this player's turn).
 */
export function botDecide(state: GameState): Action | null {
  const bot = state.players[state.turnIndex];
  if (!bot || !bot.isBot) return null;
  const k = knowledgeFor(state, bot.id);

  switch (state.phase) {
    case 'ROLL': {
      if (bot.pos.kind === 'room') {
        const dest = secretPassageTarget(bot.pos.roomId);
        if (dest) {
          const destIsUseful = k.candidates.room.includes(dest);
          const hereIsUseful = k.candidates.room.includes(bot.pos.roomId);
          // Slip through the passage when it opens up fresh ground, or when the
          // room we are standing in has already told us everything it can.
          if (destIsUseful && (!hereIsUseful || Math.random() < 0.65)) {
            return { type: 'SECRET_PASSAGE', playerId: bot.id };
          }
        }
      }
      return { type: 'ROLL', playerId: bot.id };
    }

    case 'MOVE': {
      return chooseMove(state, bot, k);
    }

    case 'SUGGEST': {
      const pick = chooseSuggestion(state, bot, k);
      if (!pick) return { type: 'SKIP_SUGGEST', playerId: bot.id };
      return { type: 'SUGGEST', playerId: bot.id, ...pick };
    }

    case 'ACCUSE': {
      return chooseAccusation(state, bot, k);
    }

    case 'END_TURN': {
      return { type: 'END_TURN', playerId: bot.id };
    }

    default:
      return null;
  }
}

/** Answer a disproval query addressed to a bot. */
export function botDisprove(state: GameState): Action | null {
  const prompt = state.pendingPrompt;
  if (!prompt) return null;
  const queried = state.players.find((p) => p.id === prompt.playerId);
  if (!queried || !queried.isBot) return null;
  const card = chooseReveal(state, queried.id, prompt.options);
  return { type: 'DISPROVE', playerId: queried.id, promptId: prompt.id, cardId: card };
}

/**
 * The host's answer when a human detective lets a query go stale: show the card
 * that leaks the least, exactly as the bots do.
 */
export function autoReveal(state: GameState): Action | null {
  const prompt = state.pendingPrompt;
  if (!prompt) return null;
  const card = chooseReveal(state, prompt.playerId, prompt.options);
  return { type: 'DISPROVE', playerId: prompt.playerId, promptId: prompt.id, cardId: card };
}

/** Suggested opening move for a bot choosing a seat in the lobby. */
export function nextFreeSuspect(state: GameState): string | null {
  const taken = new Set(state.players.map((p) => p.suspectId));
  return SUSPECTS.find((s) => !taken.has(s.id))?.id ?? null;
}

export { WEAPON_BY_ID };
