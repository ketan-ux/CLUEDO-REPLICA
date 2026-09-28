import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DOORS_LIST,
  HALL_TILES,
  classify,
  doorsOf,
  hallKey,
  isHall,
  reachable,
  roomAt,
  roomKey,
  spawnTileValidity,
  travelPath,
  distance,
} from '../shared/board.js';
import { GRID_H, GRID_W, ROOMS, SECRET_PASSAGES, SUSPECTS } from '../shared/constants.js';
import type { Position } from '../shared/types.js';

test('grid is 24 x 25', () => {
  assert.equal(GRID_W, 24);
  assert.equal(GRID_H, 25);
});

test('all six suspects spawn on hallway tiles', () => {
  for (const v of spawnTileValidity()) {
    assert.ok(v.ok, `${v.suspect} spawn must be a hallway tile`);
  }
});

test('spawns are the authentic perimeter tiles', () => {
  const expect: Record<string, { x: number; y: number }> = {
    scarlet: { x: 16, y: 0 },
    mustard: { x: 23, y: 7 },
    white: { x: 9, y: 24 },
    green: { x: 14, y: 24 },
    peacock: { x: 0, y: 18 },
    plum: { x: 0, y: 5 },
  };
  for (const s of SUSPECTS) {
    assert.deepEqual(s.spawn, expect[s.id], `${s.name} spawn`);
  }
});

test('every doorway tile is inside its room and every outside tile is a hallway neighbour', () => {
  for (const d of DOORS_LIST) {
    const room = roomAt(d.tile.x, d.tile.y);
    assert.ok(room, `${d.id} interior tile must be inside a room`);
    assert.equal(room?.id, d.roomId, `${d.id} interior tile is in ${room?.id}`);
    assert.ok(isHall(d.out.x, d.out.y), `${d.id} exterior tile ${d.out.x},${d.out.y} must be hallway`);
    const manhattan = Math.abs(d.tile.x - d.out.x) + Math.abs(d.tile.y - d.out.y);
    assert.equal(manhattan, 1, `${d.id} door must be cardinal-adjacent`);
  }
});

test('every room has at least one doorway', () => {
  for (const r of ROOMS) {
    assert.ok(doorsOf(r.id).length >= 1, `${r.name} needs a doorway`);
  }
});

test('hallway racetrack is fully connected (4-way adjacency)', () => {
  const seen = new Set<string>();
  const start = HALL_TILES[0];
  const q = [start];
  seen.add(hallKey(start.x, start.y));
  while (q.length) {
    const cur = q.shift()!;
    for (const n of [
      { x: cur.x + 1, y: cur.y },
      { x: cur.x - 1, y: cur.y },
      { x: cur.x, y: cur.y + 1 },
      { x: cur.x, y: cur.y - 1 },
    ]) {
      if (!isHall(n.x, n.y)) continue;
      const k = hallKey(n.x, n.y);
      if (seen.has(k)) continue;
      seen.add(k);
      q.push(n);
    }
  }
  assert.equal(seen.size, HALL_TILES.length, 'some hallway tiles are unreachable');
});

test('every suspect can reach every room within a sane number of pips', () => {
  for (const s of SUSPECTS) {
    const pos: Position = { kind: 'hall', x: s.spawn.x, y: s.spawn.y };
    for (const r of ROOMS) {
      const d = distance(pos, roomKey(r.id));
      assert.ok(d > 0 && d < 40, `${s.name} -> ${r.name} distance was ${d}`);
    }
  }
});

test('the vault (cellar) is never walkable and never inside a room', () => {
  for (let y = 8; y <= 14; y++) {
    for (let x = 9; x <= 13; x++) {
      assert.equal(classify(x, y), 'vault');
      assert.equal(roomAt(x, y), undefined);
    }
  }
});

test('no diagonal moves: a token in a corner hallway only reaches cardinal tiles', () => {
  const opts = reachable({ kind: 'hall', x: 0, y: 0 }, 2, new Set());
  const keys = new Set(opts.map((o) => o.key));
  assert.ok(keys.has(hallKey(2, 0)), 'east along the north gallery');
  assert.ok(keys.has(hallKey(0, 2)), 'south along the west gallery');
  assert.ok(!keys.has(hallKey(1, 1)), 'diagonal tile must not exist');
});

test('an occupied corridor tile blocks passage and cannot be entered', () => {
  const occ = new Set([hallKey(1, 0)]);
  const opts = reachable({ kind: 'hall', x: 0, y: 0 }, 2, occ);
  const keys = new Set(opts.map((o) => o.key));
  assert.ok(!keys.has(hallKey(1, 0)), 'cannot step onto an occupied tile');
  assert.ok(!keys.has(hallKey(2, 0)), 'cannot pass through an occupied tile with 2 pips');
  const opts3 = reachable({ kind: 'hall', x: 0, y: 0 }, 3, occ);
  assert.ok(!opts3.some((o) => o.key === hallKey(2, 0)), 'still blocked at 3 pips');
  assert.ok(opts3.some((o) => o.key === hallKey(0, 3)), 'can still go the long way');
});

test('entering a doorway costs one pip and deposits the token in the room', () => {
  const opts = reachable({ kind: 'hall', x: 8, y: 4 }, 1, new Set());
  const intoBallroom = opts.find((o) => o.key === roomKey('ballroom'));
  assert.ok(intoBallroom, 'one pip from the ballroom door must be enough');
  assert.equal(intoBallroom?.dist, 1);
  assert.equal(intoBallroom?.pos.kind, 'room');
});

test('a token inside a room exits through its doorways', () => {
  const opts = reachable({ kind: 'room', roomId: 'library' }, 1, new Set());
  const keys = new Set(opts.map((o) => o.key));
  assert.ok(keys.has(hallKey(0, 17)), 'west doorway of the library');
  assert.ok(keys.has(hallKey(8, 17)), 'east doorway of the library');
  assert.ok(!keys.has(roomKey('library')), 'staying put is not a move');
});

test('rooms hold any number of tokens and only doorways can block an exit', () => {
  // One blocked library doorway — the other still works.
  const half = reachable({ kind: 'room', roomId: 'library' }, 6, new Set([hallKey(0, 17)]));
  assert.ok(half.length > 0, 'the east doorway is still usable');
  assert.ok(!half.some((o) => o.pos.kind === 'hall' && o.pos.x === 0 && o.pos.y === 17));

  // Both doorways blocked — the detective is temporarily boxed in (the engine
  // treats this as "no legal moves" and passes the turn).
  const both = reachable({ kind: 'room', roomId: 'library' }, 6, new Set([hallKey(0, 17), hallKey(8, 17)]));
  assert.equal(both.length, 0, 'a fully blocked room leaves no legal move');
});

test('any number of tokens may stand inside the same room', () => {
  const opts = reachable({ kind: 'hall', x: 11, y: 7 }, 5, new Set());
  assert.ok(opts.some((o) => o.key === roomKey('ballroom')), 'courtyard door reachable');
});

test('token travel paths run from room to room through the hallway', () => {
  const p = travelPath('kitchen', 'study');
  assert.equal(p[0].kind, 'room');
  assert.equal(p[p.length - 1].kind, 'room');
  assert.ok(p.length > 5, 'path should traverse the hallway');
  for (const step of p.slice(1, -1)) {
    assert.equal(step.kind, 'hall');
    if (step.kind === 'hall') assert.ok(isHall(step.x, step.y));
  }
});

test('secret passages exist between the authentic diagonal pairs', () => {
  
  assert.equal(SECRET_PASSAGES.kitchen, 'study');
  assert.equal(SECRET_PASSAGES.study, 'kitchen');
  assert.equal(SECRET_PASSAGES.lounge, 'conservatory');
  assert.equal(SECRET_PASSAGES.conservatory, 'lounge');
});
