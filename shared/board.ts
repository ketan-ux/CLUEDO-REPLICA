/**
 * Board geometry: tile classification, the walkable graph (rooms treated as
 * single named spaces, exactly as the physical board), BFS movement and the
 * token travel paths used for weapon/suspect teleports.
 */
import {
  DOORS,
  GRID_H,
  GRID_W,
  HALL_BANDS,
  ROOMS,
  ROOM_BY_ID,
  SECRET_PASSAGES,
  SUSPECTS,
  VAULT,
} from './constants.js';
import type { NodeKey, Position, RoomMeta } from './types.js';

export type TileClass = 'hall' | 'room' | 'vault' | 'wall';

export interface Door {
  id: string;
  roomId: string;
  tile: { x: number; y: number };
  out: { x: number; y: number };
  dir: 'n' | 's' | 'e' | 'w';
}

export const DOORS_LIST: Door[] = DOORS as Door[];

export const DOOR_BY_TILE = new Map<string, Door>();
export const DOOR_BY_OUT = new Map<string, Door[]>();
for (const d of DOORS_LIST) {
  DOOR_BY_TILE.set(`${d.tile.x},${d.tile.y}`, d);
  const list = DOOR_BY_OUT.get(`${d.out.x},${d.out.y}`) ?? [];
  list.push(d);
  DOOR_BY_OUT.set(`${d.out.x},${d.out.y}`, list);
}

export function roomAt(x: number, y: number): RoomMeta | undefined {
  return ROOMS.find((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1);
}

export function inVault(x: number, y: number): boolean {
  return x >= VAULT.x0 && x <= VAULT.x1 && y >= VAULT.y0 && y <= VAULT.y1;
}

export function inBounds(x: number, y: number): boolean {
  return x >= 0 && x < GRID_W && y >= 0 && y < GRID_H;
}

/** True when the tile belongs to the hallway racetrack (never inside a room). */
export function isHall(x: number, y: number): boolean {
  if (!inBounds(x, y)) return false;
  if (roomAt(x, y)) return false;
  if (inVault(x, y)) return false;
  if (y === 0 || y === GRID_H - 1) return true; // north + south galleries
  if (x === 0 || x === GRID_W - 1) return true; // west + east galleries
  if (HALL_BANDS.verticals.includes(x)) return true;
  if (HALL_BANDS.horizontals.includes(y)) return true;
  for (const s of HALL_BANDS.spurs) {
    if (y === s.y && x >= s.x0 && x <= s.x1) return true;
  }
  return false;
}

export function classify(x: number, y: number): TileClass {
  if (!inBounds(x, y)) return 'wall';
  if (inVault(x, y)) return 'vault';
  if (roomAt(x, y)) return 'room';
  if (isHall(x, y)) return 'hall';
  return 'wall';
}

export function hallKey(x: number, y: number): NodeKey {
  return `h:${x},${y}`;
}

/**
 * Board node keys carry an `rm:` prefix so a room *space* can never be confused
 * with the identically-named room *card* (`r:study`) in logs, masks or tests.
 */
export function roomKey(roomId: string): NodeKey {
  return `rm:${roomId}`;
}

export function parseKey(key: NodeKey): Position {
  if (key.startsWith('rm:')) return { kind: 'room', roomId: key.slice(3) };
  const [x, y] = key.slice(2).split(',').map(Number);
  return { kind: 'hall', x, y };
}

export function keyOfPos(pos: Position): NodeKey {
  return pos.kind === 'room' ? roomKey(pos.roomId) : hallKey(pos.x, pos.y);
}

/** All hallway tiles of the racetrack, precomputed. */
export const HALL_TILES: { x: number; y: number }[] = (() => {
  const out: { x: number; y: number }[] = [];
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (isHall(x, y)) out.push({ x, y });
    }
  }
  return out;
})();

/** Hallway-to-hallway cardinal neighbours. Rooms are never traversed. */
export function hallNeighbours(x: number, y: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const cand = [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 },
  ];
  for (const c of cand) if (isHall(c.x, c.y)) out.push(c);
  return out;
}

export function doorsOf(roomId: string): Door[] {
  return DOORS_LIST.filter((d) => d.roomId === roomId);
}

export function doorOutTilesOf(roomId: string): { x: number; y: number }[] {
  return doorsOf(roomId).map((d) => d.out);
}

/* ------------------------------------------------------------------ */
/* Occupancy + BFS                                                     */
/* ------------------------------------------------------------------ */

export type Occupancy = Set<string>;

export function buildOccupancy(
  players: { id: string; pos: Position; eliminated?: boolean }[],
  exceptPlayerId?: string,
): Occupancy {
  const occ: Occupancy = new Set();
  for (const p of players) {
    if (p.eliminated) continue; // witnesses step aside
    if (exceptPlayerId && p.id === exceptPlayerId) continue;
    if (p.pos.kind === 'hall') occ.add(hallKey(p.pos.x, p.pos.y));
    // Rooms are named spaces: any number of tokens may share them.
  }
  return occ;
}

export interface MoveOption {
  key: NodeKey;
  pos: Position;
  dist: number;
  path: Position[];
  /** True for the "remain in this room" option offered to a token already inside. */
  stay?: boolean;
}

const DIRS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

/**
 * Every space reachable within `steps` pips.
 *
 * Rules implemented:
 *  - no diagonals, cardinal hallway steps only;
 *  - walls and the sealed Cellar vault are impassable;
 *  - an occupied hallway tile may not be entered or passed through;
 *  - stepping from the hallway onto a room's doorway tile costs one pip and
 *    deposits the token inside that room;
 *  - a token already inside a room leaves through any of its doorways (one pip)
 *    — rooms are never traversed.
 */
interface ReachEntry {
  dist: number;
  path: Position[];
}

/** Multi-source BFS over the hallway racetrack (all edges cost exactly 1 pip). */
function bfs(from: Position, steps: number, occ: Occupancy): Map<NodeKey, ReachEntry> {
  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();
  const seeds: { x: number; y: number; cost: number; parent: string | null }[] = [];

  if (from.kind === 'hall') {
    seeds.push({ x: from.x, y: from.y, cost: 0, parent: null });
  } else {
    // Leaving a room costs one pip onto the hallway tile outside any doorway.
    for (const d of doorsOf(from.roomId)) {
      if (occ.has(hallKey(d.out.x, d.out.y))) continue;
      seeds.push({ x: d.out.x, y: d.out.y, cost: 1, parent: roomKey(from.roomId) });
    }
  }

  for (const s of seeds) {
    const k = hallKey(s.x, s.y);
    if (!dist.has(k) || (dist.get(k) as number) > s.cost) {
      dist.set(k, s.cost);
      prev.set(k, s.parent);
    }
  }

  const queue: { x: number; y: number }[] = seeds
    .filter((s) => s.cost <= steps)
    .map((s) => ({ x: s.x, y: s.y }));
  queue.sort((a, b) => (dist.get(hallKey(a.x, a.y)) ?? 0) - (dist.get(hallKey(b.x, b.y)) ?? 0));

  while (queue.length) {
    const cur = queue.shift() as { x: number; y: number };
    const ck = hallKey(cur.x, cur.y);
    const d = dist.get(ck) as number;
    if (d >= steps) continue;
    for (const dir of DIRS) {
      const nx = cur.x + dir.dx;
      const ny = cur.y + dir.dy;
      if (!isHall(nx, ny)) continue; // walls, rooms and the vault are impassable
      const nk = hallKey(nx, ny);
      if (occ.has(nk)) continue; // another detective's token blocks the corridor
      const nd = d + 1;
      if (nd < (dist.get(nk) ?? Infinity)) {
        dist.set(nk, nd);
        prev.set(nk, ck);
        if (nd <= steps) queue.push({ x: nx, y: ny });
      }
    }
  }

  const chainOf = (k: string): Position[] => {
    const chain: string[] = [];
    let cur: string | null | undefined = k;
    let guard = 0;
    while (cur && guard++ < 800) {
      chain.push(cur);
      const p = prev.get(cur);
      cur = p === undefined || p === null ? null : p;
      if (cur && !cur.startsWith('h:')) {
        chain.push(cur);
        break;
      }
    }
    chain.reverse();
    return chain.map((key) => parseKey(key));
  };

  const out = new Map<NodeKey, ReachEntry>();
  for (const [k, d] of dist) {
    if (d > steps) continue;
    const chain = chainOf(k);
    // Every path begins where the token stands: the walk-back ends at the room
    // it left (or the hallway tile it started on), so only prepend when the
    // reconstruction somehow lost the origin.
    const startsAtOrigin = chain.length > 0 && keyOfPos(chain[0]) === keyOfPos(from);
    out.set(k, { dist: d, path: startsAtOrigin ? chain : [from, ...chain] });
  }
  return out;
}

/** All spaces reachable from `from` within `steps` pips (see rules above `bfs`). */
export function reachable(from: Position, steps: number, occ: Occupancy): MoveOption[] {
  const reached = bfs(from, steps, occ);
  const options = new Map<NodeKey, MoveOption>();

  for (const [k, entry] of reached) {
    if (entry.dist <= 0) continue; // standing still is not a move
    options.set(k, {
      key: k,
      pos: parseKey(k),
      dist: entry.dist,
      path: [from, ...entry.path.filter((p, i) => !(i === 0 && keyOfPos(p) === keyOfPos(from)))],
    });
  }

  // Entering a room: from any reached hallway tile that sits outside a doorway,
  // one further pip deposits the token inside.
  for (const [k, entry] of reached) {
    const cell = parseKey(k);
    if (cell.kind !== 'hall') continue;
    for (const door of DOOR_BY_OUT.get(`${cell.x},${cell.y}`) ?? []) {
      const cost = entry.dist + 1;
      if (cost > steps) continue;
      const rk = roomKey(door.roomId);
      if (from.kind === 'room' && from.roomId === door.roomId) continue; // already inside
      const existing = options.get(rk);
      if (existing && existing.dist <= cost) continue;
      const into: Position = { kind: 'room', roomId: door.roomId, doorId: door.id };
      options.set(rk, {
        key: rk,
        pos: into,
        dist: cost,
        path: [...entry.path, into],
      });
    }
  }

  return [...options.values()].sort((a, b) => a.dist - b.dist || a.key.localeCompare(b.key));
}

/**
 * The route a token takes when it is summoned across the mansion — a pawn moved
 * from a corridor, or a weapon paraded from room to room by a suggestion. The
 * engine hands this path to every client so the whole table watches the same
 * token travel the same way.
 */
export function pathToRoom(from: Position, toRoomId: string): Position[] {
  if (from.kind === 'room' && from.roomId === toRoomId) return [from];
  const reached = bfs(from, 48, new Set<string>());
  let best: { d: number; path: Position[]; doorId: string } | null = null;
  for (const door of doorsOf(toRoomId)) {
    const entry = reached.get(hallKey(door.out.x, door.out.y));
    if (!entry) continue;
    if (!best || entry.dist < best.d) best = { d: entry.dist, path: entry.path, doorId: door.id };
  }
  const arrival: Position = { kind: 'room', roomId: toRoomId, doorId: best?.doorId };
  // Every path begins where the token actually stands, so the animation starts
  // at its current space rather than jumping to the first hallway tile.
  if (!best) return [from, arrival];
  return [...best.path, arrival];
}

/** Convenience wrapper for room-to-room teleports. */
export function travelPath(fromRoomId: string, toRoomId: string): Position[] {
  return pathToRoom({ kind: 'room', roomId: fromRoomId }, toRoomId);
}

/**
 * One multi-source flood from every doorway of the given rooms, backwards across
 * the (undirected) hallway graph. The result answers "how many pips from this
 * tile to the nearest of those rooms?" for *every* tile at once — the same
 * question the AI would otherwise ask once per candidate destination.
 */
export function doorwayFlood(roomIds: string[], maxSteps = 30, occ: Occupancy = new Set()): Map<string, number> {
  const dist = new Map<string, number>();
  const queue: { x: number; y: number }[] = [];
  for (const roomId of roomIds) {
    for (const out of doorOutTilesOf(roomId)) {
      const k = hallKey(out.x, out.y);
      if (occ.has(k)) continue;
      if (!dist.has(k)) {
        dist.set(k, 0);
        queue.push(out);
      }
    }
  }
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const d = dist.get(hallKey(cur.x, cur.y)) ?? 0;
    if (d >= maxSteps) continue;
    for (const dir of DIRS) {
      const nx = cur.x + dir.dx;
      const ny = cur.y + dir.dy;
      if (!isHall(nx, ny)) continue;
      const nk = hallKey(nx, ny);
      if (dist.has(nk) || occ.has(nk)) continue;
      dist.set(nk, d + 1);
      queue.push({ x: nx, y: ny });
    }
  }
  return dist;
}

/** Pips from each hallway tile to the nearest room in `roomIds` (tile enters at +1). */
export function nearestRoomPips(flood: Map<string, number>, tile: { x: number; y: number }): number {
  const d = flood.get(hallKey(tile.x, tile.y));
  return d === undefined ? Infinity : d + 1;
}

/** BFS distance (in pips) between two spaces, used by the AI heuristic. */
export function distance(from: Position, toKey: NodeKey): number {
  if (keyOfPos(from) === toKey) return 0;
  const reached = bfs(from, 30, new Set<string>());
  if (toKey.startsWith('h:')) return reached.get(toKey)?.dist ?? Infinity;
  const roomId = toKey.slice(3);
  if (from.kind === 'room' && from.roomId === roomId) return 0;
  let best = Infinity;
  for (const out of doorOutTilesOf(roomId)) {
    const d = reached.get(hallKey(out.x, out.y))?.dist;
    if (d !== undefined) best = Math.min(best, d + 1);
  }
  return best;
}

/** Authoritative spawn tiles for the six suspects. */
export const SPAWNS: Record<string, Position> = Object.fromEntries(
  SUSPECTS.map((s) => [s.id, { kind: 'hall', x: s.spawn.x, y: s.spawn.y } as Position]),
);

/** Doorway tile used for reaching a room from a hallway tile (for AI waypoints). */
export function doorwayApproach(roomId: string): { x: number; y: number }[] {
  return doorOutTilesOf(roomId);
}

export function secretPassageTarget(roomId: string): string | undefined {
  return SECRET_PASSAGES[roomId];
}

export function roomName(roomId: string): string {
  return ROOM_BY_ID[roomId]?.name ?? roomId;
}

/** Every hallway tile occupied by a suspect spawn — sanity helper for tests. */
export function spawnTileValidity(): { suspect: string; ok: boolean }[] {
  return SUSPECTS.map((s) => ({
    suspect: s.name,
    ok: isHall(s.spawn.x, s.spawn.y),
  }));
}
