/**
 * Deduction engine.
 *
 * Turns the *public* record of suggestions (who passed, who disproved) plus the
 * viewer's own private knowledge (their hand and the cards shown to them) into a
 * sharpened picture of the three cards sealed in the envelope.
 *
 * The same code powers the AI on the host, the "you can now conclude…" hints and
 * the automatic ✗ marks in the detective notebook — and because it is built only
 * from information that viewer legitimately holds, it can never be used to peek.
 */
import {
  CARD_BY_ID,
  NOTEBOOK_ITEMS,
  ROOM_BY_ID,
  SUSPECT_BY_ID,
  WEAPON_BY_ID,
  itemIdOf,
} from './constants.js';
import type { CardKind, GameState, MaskedState, QueryRecord } from './types.js';

export interface KnowledgeInput {
  meId: string;
  hand: string[];
  reveals: { cardId: string; byId: string; toId: string }[];
  queries: QueryRecord[];
  players: { id: string }[];
}

export interface Knowledge {
  meId: string;
  /** Card ids this detective has personally seen (own hand + cards shown to them). */
  seen: Set<string>;
  /** Item ids confirmed innocent (✓) — the card is in somebody's hand, not the envelope. */
  clearedItems: Set<string>;
  /** Item ids struck out by logic (✗) — provably not the envelope's card. */
  ruledOutItems: Set<string>;
  /** playerId -> cards that player has publicly proved they do NOT hold. */
  notHeld: Map<string, Set<string>>;
  /** Item ids that could still be inside the envelope, per category. */
  candidates: Record<CardKind, string[]>;
  /** Items proven (or logically forced) to be inside the envelope. */
  certain: Partial<Record<CardKind, string>>;
  /** True when all three categories are down to a single possibility. */
  solved: boolean;
  /** The complete accusation this detective could now make with certainty. */
  solution: { suspectId: string; weaponId: string; roomId: string } | null;
}

const KINDS: CardKind[] = ['suspect', 'weapon', 'room'];
const PREFIX: Record<CardKind, string> = { suspect: 's', weapon: 'w', room: 'r' };

export function knowledgeFrom(input: KnowledgeInput): Knowledge {
  const seen = new Set<string>(input.hand);
  for (const r of input.reveals) {
    if (r.byId === input.meId || r.toId === input.meId) seen.add(r.cardId);
  }

  // Public knowledge: everyone who passed on a theory demonstrably holds none of
  // its three cards, and the whole table watches them pass.
  const notHeld = new Map<string, Set<string>>();
  for (const p of input.players) notHeld.set(p.id, new Set());
  for (const q of input.queries) {
    for (const id of q.passed) {
      const set = notHeld.get(id) ?? new Set<string>();
      for (const c of q.cards) set.add(c);
      notHeld.set(id, set);
    }
  }

  const clearedItems = new Set<string>();
  for (const c of seen) clearedItems.add(itemIdOf(c));

  const ruledOutItems = new Set<string>();
  const candidates: Record<CardKind, string[]> = { suspect: [], weapon: [], room: [] };
  const certain: Partial<Record<CardKind, string>> = {};

  for (const kind of KINDS) {
    const items = NOTEBOOK_ITEMS[kind] as readonly string[];
    const rest = items.filter((item) => !clearedItems.has(item));

    // An item must be the envelope's card when nobody else at the table holds it
    // (and we know we do not hold it ourselves).
    const enforced = rest.filter((item) => {
      const cardId = `${PREFIX[kind]}:${item}`;
      return (
        input.players.length > 1 &&
        input.players
          .filter((p) => p.id !== input.meId)
          .every((p) => notHeld.get(p.id)?.has(cardId))
      );
    });

    if (enforced.length >= 1) {
      // Only one card of each category can be in the envelope, so a second
      // "enforced" item would mean the pass record is incomplete; trust the
      // first and mark the rest as not-yet-known.
      const chosen = enforced[0];
      certain[kind] = chosen;
      candidates[kind] = [chosen];
      for (const item of rest) if (item !== chosen) ruledOutItems.add(item);
    } else if (rest.length === 1) {
      // Everything else of this category has been seen in somebody's hand.
      certain[kind] = rest[0];
      candidates[kind] = [rest[0]];
    } else {
      candidates[kind] = rest;
    }
  }

  const solved = KINDS.every((k) => candidates[k].length === 1);
  const solution =
    solved && certain.suspect && certain.weapon && certain.room
      ? { suspectId: certain.suspect, weaponId: certain.weapon, roomId: certain.room }
      : null;

  return { meId: input.meId, seen, clearedItems, ruledOutItems, notHeld, candidates, certain, solved, solution };
}

export function knowledgeFor(state: GameState, playerId: string): Knowledge {
  const me = state.players.find((p) => p.id === playerId);
  return knowledgeFrom({
    meId: playerId,
    hand: me?.hand ?? [],
    reveals: state.reveals,
    queries: state.queries,
    players: state.players,
  });
}

export function knowledgeFromMask(masked: MaskedState): Knowledge {
  return knowledgeFrom({
    meId: masked.you,
    hand: masked.hand,
    reveals: masked.reveals,
    queries: masked.queries,
    players: masked.players,
  });
}

/**
 * What should the notebook show? ✓ for anything confirmed innocent, ✗ for
 * anything struck out, ? for a forced envelope card.
 */
export function autoStamps(
  k: Knowledge,
  current: Record<string, string>,
): Record<string, string> {
  const next = { ...current };
  for (const item of k.clearedItems) next[item] = 'cleared';
  for (const item of k.ruledOutItems) {
    if (!k.clearedItems.has(item)) next[item] = 'ruled';
  }
  for (const kind of KINDS) {
    const item = k.certain[kind];
    if (item && !k.clearedItems.has(item)) next[item] = 'suspected';
  }
  return next;
}

/** Human-readable list of the cards this detective has cornered. */
export function describeCertain(k: Knowledge): string[] {
  const out: string[] = [];
  if (k.certain.suspect) out.push(SUSPECT_BY_ID[k.certain.suspect]?.name ?? k.certain.suspect);
  if (k.certain.weapon) out.push(WEAPON_BY_ID[k.certain.weapon]?.name ?? k.certain.weapon);
  if (k.certain.room) out.push(ROOM_BY_ID[k.certain.room]?.name ?? k.certain.room);
  return out;
}

export function cardName(cardId: string): string {
  return CARD_BY_ID[cardId]?.name ?? cardId;
}

/**
 * If every detective passes on a theory, which of its cards must be sealed away?
 * (Drives the "Unrefuted Theory" breakthrough modal.)
 */
export function concludeFromUnrefuted(k: Knowledge, cards: string[]): string[] {
  return cards.filter((c) => !k.seen.has(c));
}
