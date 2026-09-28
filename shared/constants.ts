/**
 * Canonical Cluedo card set, suspect metadata, spawn tiles and the 1920s noir palette.
 * Everything here is shared by the host, the client and the AI so all three agree.
 */
import type { Card, CardKind, RoomMeta, SuspectMeta } from './types.js';

/* ------------------------------------------------------------------ */
/* Palette — 1920s Art Deco Noir                                       */
/* ------------------------------------------------------------------ */
export const PALETTE = {
  ink: '#0a0b0e',
  ink2: '#12151c',
  ink3: '#1b2028',
  coal: '#05060a',
  parchment: '#e6ddc4',
  parchmentLight: '#f5ebd7',
  parchmentDim: '#cbbfa1',
  gold: '#d4af37',
  brass: '#b89028',
  goldLight: '#f0d67a',
  crimson: '#7a1c1c',
  crimsonBright: '#a52626',
  emerald: '#2f6b4f',
  sapphire: '#2b4d7e',
  amber: '#e0a93a',
  fog: 'rgba(214,196,150,0.06)',
} as const;

export const FONTS = {
  display: "'Playfair Display', 'Didot', 'Bodoni MT', Georgia, serif",
  body: "'Cormorant Garamond', 'Garamond', Georgia, serif",
  mono: "'Courier New', 'IBM Plex Mono', monospace",
} as const;

/* ------------------------------------------------------------------ */
/* Suspects — seat order is the authentic clockwise turn order          */
/* ------------------------------------------------------------------ */
export const SUSPECTS: SuspectMeta[] = [
  {
    id: 'scarlet',
    name: 'Miss Scarlet',
    short: 'Scarlet',
    color: '#b4232a',
    glow: '#ff6b6b',
    spawn: { x: 16, y: 0 },
    title: 'The Femme Fatale',
  },
  {
    id: 'mustard',
    name: 'Colonel Mustard',
    short: 'Mustard',
    color: '#d4af37',
    glow: '#ffe08a',
    spawn: { x: 23, y: 7 },
    title: 'The Old Soldier',
  },
  {
    id: 'white',
    name: 'Mrs. White',
    short: 'White',
    color: '#e8e3d3',
    glow: '#ffffff',
    spawn: { x: 9, y: 24 },
    title: 'The Housekeeper',
  },
  {
    id: 'green',
    name: 'Mr. Green',
    short: 'Green',
    color: '#2f6b4f',
    glow: '#74e2a8',
    spawn: { x: 14, y: 24 },
    title: 'The Financier',
  },
  {
    id: 'peacock',
    name: 'Mrs. Peacock',
    short: 'Peacock',
    color: '#2b4d7e',
    glow: '#7fb2ff',
    spawn: { x: 0, y: 18 },
    title: 'The Widow',
  },
  {
    id: 'plum',
    name: 'Professor Plum',
    short: 'Plum',
    color: '#6b3f8f',
    glow: '#c9a0ff',
    spawn: { x: 0, y: 5 },
    title: 'The Academic',
  },
];

export const SUSPECT_BY_ID: Record<string, SuspectMeta> = Object.fromEntries(
  SUSPECTS.map((s) => [s.id, s]),
);

/* ------------------------------------------------------------------ */
/* Weapons                                                             */
/* ------------------------------------------------------------------ */
export interface WeaponMeta {
  id: string;
  name: string;
  short: string;
  /** Room the token starts in. */
  startRoom: string;
  glyph: string;
}

export const WEAPONS: WeaponMeta[] = [
  { id: 'candlestick', name: 'Candlestick', short: 'Candlestick', startRoom: 'dining', glyph: '🕯' },
  { id: 'dagger', name: 'Dagger', short: 'Dagger', startRoom: 'study', glyph: '🗡' },
  { id: 'leadpipe', name: 'Lead Pipe', short: 'Lead Pipe', startRoom: 'conservatory', glyph: '🔧' },
  { id: 'revolver', name: 'Revolver', short: 'Revolver', startRoom: 'library', glyph: '🔫' },
  { id: 'rope', name: 'Rope', short: 'Rope', startRoom: 'lounge', glyph: '🪢' },
  { id: 'wrench', name: 'Wrench', short: 'Wrench', startRoom: 'ballroom', glyph: '🔩' },
];

export const WEAPON_BY_ID: Record<string, WeaponMeta> = Object.fromEntries(
  WEAPONS.map((w) => [w.id, w]),
);

/* ------------------------------------------------------------------ */
/* The Tudor mansion — a 24 x 25 tile grid                             */
/*                                                                     */
/*   x -> 0..23 (west to east)   y -> 0..24 (north to south)           */
/*                                                                     */
/*   The hallways form a double racetrack: an outer gallery that runs   */
/*   the full perimeter (where the six suspects spawn) plus an inner    */
/*   loop that wraps the sealed Cellar vault in the dead centre of the  */
/*   mansion, with two vertical and two horizontal corridors joining    */
/*   them.                                                             */
/* ------------------------------------------------------------------ */
export const GRID_W = 24;
export const GRID_H = 25;

export const ROOMS: RoomMeta[] = [
  {
    id: 'conservatory',
    name: 'Conservatory',
    short: 'Conservatory',
    x0: 1,
    y0: 1,
    x1: 7,
    y1: 6,
    passageTo: 'lounge',
    motif: 'glass',
    accent: '#2f6b4f',
  },
  {
    id: 'ballroom',
    name: 'Ballroom',
    short: 'Ballroom',
    x0: 9,
    y0: 1,
    x1: 13,
    y1: 6,
    motif: 'chandelier',
    accent: '#a52626',
  },
  {
    id: 'kitchen',
    name: 'Kitchen',
    short: 'Kitchen',
    x0: 15,
    y0: 1,
    x1: 22,
    y1: 6,
    passageTo: 'study',
    motif: 'range',
    accent: '#8a5a2b',
  },
  {
    id: 'billiard',
    name: 'Billiard Room',
    short: 'Billiard Room',
    x0: 1,
    y0: 8,
    x1: 7,
    y1: 14,
    motif: 'baize',
    accent: '#2f6b4f',
  },
  {
    id: 'dining',
    name: 'Dining Room',
    short: 'Dining Room',
    x0: 15,
    y0: 8,
    x1: 22,
    y1: 14,
    motif: 'banquet',
    accent: '#7a1c1c',
  },
  {
    id: 'library',
    name: 'Library',
    short: 'Library',
    x0: 1,
    y0: 16,
    x1: 7,
    y1: 18,
    motif: 'books',
    accent: '#6b3f8f',
  },
  {
    id: 'hall',
    name: 'Hall',
    short: 'Hall',
    x0: 9,
    y0: 16,
    x1: 13,
    y1: 23,
    motif: 'grand',
    accent: '#b89028',
  },
  {
    id: 'lounge',
    name: 'Lounge',
    short: 'Lounge',
    x0: 15,
    y0: 16,
    x1: 22,
    y1: 23,
    passageTo: 'conservatory',
    motif: 'fireside',
    accent: '#7a1c1c',
  },
  {
    id: 'study',
    name: 'Study',
    short: 'Study',
    x0: 1,
    y0: 20,
    x1: 7,
    y1: 23,
    passageTo: 'kitchen',
    motif: 'desk',
    accent: '#8a5a2b',
  },
];

export const ROOM_BY_ID: Record<string, RoomMeta> = Object.fromEntries(
  ROOMS.map((r) => [r.id, r]),
);

/** The sealed vault at the heart of the mansion — never walkable, holds the envelope. */
export const VAULT = { id: 'cellar', name: 'The Cellar', x0: 9, y0: 8, x1: 13, y1: 14 };

/**
 * Doorways. `tile` is a walkable tile *inside* the room (drawn as the doorway
 * notch), `out` is the hallway tile directly outside it. Stepping from `out`
 * onto `tile` consumes one pip and deposits the token in the room.
 */
export const DOORS: {
  id: string;
  roomId: string;
  tile: { x: number; y: number };
  out: { x: number; y: number };
  dir: 'n' | 's' | 'e' | 'w';
}[] = [
  // Conservatory (top-left)
  { id: 'cons-n', roomId: 'conservatory', tile: { x: 3, y: 1 }, out: { x: 3, y: 0 }, dir: 'n' },
  { id: 'cons-e', roomId: 'conservatory', tile: { x: 7, y: 3 }, out: { x: 8, y: 3 }, dir: 'e' },
  // Ballroom (top-centre)
  { id: 'ball-w', roomId: 'ballroom', tile: { x: 9, y: 4 }, out: { x: 8, y: 4 }, dir: 'w' },
  { id: 'ball-e', roomId: 'ballroom', tile: { x: 13, y: 3 }, out: { x: 14, y: 3 }, dir: 'e' },
  { id: 'ball-s', roomId: 'ballroom', tile: { x: 11, y: 6 }, out: { x: 11, y: 7 }, dir: 's' },
  // Kitchen (top-right)
  { id: 'kitch-n', roomId: 'kitchen', tile: { x: 18, y: 1 }, out: { x: 18, y: 0 }, dir: 'n' },
  { id: 'kitch-w', roomId: 'kitchen', tile: { x: 15, y: 4 }, out: { x: 14, y: 4 }, dir: 'w' },
  { id: 'kitch-s', roomId: 'kitchen', tile: { x: 19, y: 6 }, out: { x: 19, y: 7 }, dir: 's' },
  // Billiard Room (middle-left)
  { id: 'bill-w', roomId: 'billiard', tile: { x: 1, y: 10 }, out: { x: 0, y: 10 }, dir: 'w' },
  { id: 'bill-e', roomId: 'billiard', tile: { x: 7, y: 11 }, out: { x: 8, y: 11 }, dir: 'e' },
  // Dining Room (middle-right)
  { id: 'dine-e', roomId: 'dining', tile: { x: 22, y: 10 }, out: { x: 23, y: 10 }, dir: 'e' },
  { id: 'dine-w', roomId: 'dining', tile: { x: 15, y: 11 }, out: { x: 14, y: 11 }, dir: 'w' },
  { id: 'dine-s', roomId: 'dining', tile: { x: 18, y: 14 }, out: { x: 18, y: 15 }, dir: 's' },
  // Library (lower-left)
  { id: 'lib-w', roomId: 'library', tile: { x: 1, y: 17 }, out: { x: 0, y: 17 }, dir: 'w' },
  { id: 'lib-e', roomId: 'library', tile: { x: 7, y: 17 }, out: { x: 8, y: 17 }, dir: 'e' },
  // Hall (bottom-centre)
  { id: 'hall-n', roomId: 'hall', tile: { x: 11, y: 16 }, out: { x: 11, y: 15 }, dir: 'n' },
  { id: 'hall-w', roomId: 'hall', tile: { x: 9, y: 20 }, out: { x: 8, y: 20 }, dir: 'w' },
  { id: 'hall-s', roomId: 'hall', tile: { x: 11, y: 23 }, out: { x: 11, y: 24 }, dir: 's' },
  // Lounge (bottom-right)
  { id: 'loun-e', roomId: 'lounge', tile: { x: 22, y: 19 }, out: { x: 23, y: 19 }, dir: 'e' },
  { id: 'loun-w', roomId: 'lounge', tile: { x: 15, y: 19 }, out: { x: 14, y: 19 }, dir: 'w' },
  { id: 'loun-s', roomId: 'lounge', tile: { x: 19, y: 23 }, out: { x: 19, y: 24 }, dir: 's' },
  // Study (bottom-left)
  { id: 'study-w', roomId: 'study', tile: { x: 1, y: 21 }, out: { x: 0, y: 21 }, dir: 'w' },
  { id: 'study-e', roomId: 'study', tile: { x: 7, y: 21 }, out: { x: 8, y: 21 }, dir: 'e' },
  { id: 'study-s', roomId: 'study', tile: { x: 4, y: 23 }, out: { x: 4, y: 24 }, dir: 's' },
];

/** Vertical + horizontal hallway bands of the racetrack. */
export const HALL_BANDS = {
  perimeter: true,
  verticals: [8, 14],
  horizontals: [7, 15],
  /** A short spur that separates the Library from the Study. */
  spurs: [{ y: 19, x0: 1, x1: 7 }],
};

export const SECRET_PASSAGES: Record<string, string> = {
  conservatory: 'lounge',
  lounge: 'conservatory',
  study: 'kitchen',
  kitchen: 'study',
};

/* ------------------------------------------------------------------ */
/* Deck                                                                */
/* ------------------------------------------------------------------ */
export const CARD_KIND_ORDER: CardKind[] = ['suspect', 'weapon', 'room'];

export const CARDS: Card[] = [
  ...SUSPECTS.map<Card>((s) => ({ id: `s:${s.id}`, kind: 'suspect' as const, name: s.name })),
  ...WEAPONS.map<Card>((w) => ({ id: `w:${w.id}`, kind: 'weapon' as const, name: w.name })),
  ...ROOMS.map<Card>((r) => ({ id: `r:${r.id}`, kind: 'room' as const, name: r.name })),
];

export const CARD_BY_ID: Record<string, Card> = Object.fromEntries(CARDS.map((c) => [c.id, c]));

export function itemIdOf(cardId: string): string {
  return cardId.split(':')[1];
}

export function cardIdFor(kind: CardKind, itemId: string): string {
  const prefix = kind === 'suspect' ? 's' : kind === 'weapon' ? 'w' : 'r';
  return `${prefix}:${itemId}`;
}

export const NOTEBOOK_ITEMS = {
  suspect: SUSPECTS.map((s) => s.id),
  weapon: WEAPONS.map((w) => w.id),
  room: ROOMS.map((r) => r.id),
} as const;

export function itemName(kind: CardKind, id: string): string {
  if (kind === 'suspect') return SUSPECTS.find((s) => s.id === id)?.name ?? id;
  if (kind === 'weapon') return WEAPONS.find((w) => w.id === id)?.name ?? id;
  return ROOMS.find((r) => r.id === id)?.name ?? id;
}

/** Bot name pool — hosts can seat up to six. */
export const BOT_NAMES = [
  'Inspector Lestrade',
  'Sergeant Doyle',
  'Mademoiselle Noir',
  'Constable Ash',
  'Dr. Corvid',
  'Lady Ravenscroft',
];
