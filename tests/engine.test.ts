import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addHuman, createLobby, maskState, playerById, reduce, startGame } from '../shared/engine.js';
import { CARDS, SUSPECTS, WEAPONS } from '../shared/constants.js';
import { isHall, keyOfPos, roomKey } from '../shared/board.js';
import type { Action, GameState } from '../shared/types.js';

function lobbyWithBots(n = 6, seed = 12345): GameState {
  let s = createLobby('TEST', seed);
  s = addHuman(s, 'host', 'Host', SUSPECTS[0].id, true);
  for (let i = 1; i < n; i++) {
    const res = reduce(s, { type: 'ADD_BOT', playerId: 'host' });
    assert.equal(res.ok, true);
    if (res.ok) s = res.state;
  }
  const started = reduce(s, { type: 'START_GAME', playerId: 'host' });
  assert.equal(started.ok, true);
  return started.ok ? started.state : s;
}

/** Put `playerId` inside `roomId` with the SUGGEST phase open, ready to talk. */
function readyToSuggest(s: GameState, playerId: string, roomId: string): GameState {
  return {
    ...s,
    phase: 'SUGGEST',
    players: s.players.map((p) => (p.id === playerId ? { ...p, pos: { kind: 'room' as const, roomId } } : p)),
  };
}

function apply(s: GameState, a: Action): GameState {
  const res = reduce(s, a);
  assert.equal(res.ok, true, `action ${a.type} should be legal: ${res.ok ? '' : res.error}`);
  return res.ok ? res.state : s;
}

test('a fresh lobby has no envelope and no hands', () => {
  const s = createLobby('ABCD');
  assert.equal(s.phase, 'LOBBY');
  assert.equal(s.envelope.length, 0);
  assert.equal(s.players.length, 0);
});

test('setup seals one suspect, one weapon and one room, then deals the other 18', () => {
  const s = lobbyWithBots(4, 99);
  assert.equal(s.envelope.length, 3);
  const kinds = s.envelope.map((c) => c[0]).sort();
  assert.deepEqual(kinds, ['r', 's', 'w']);
  const dealt = s.players.flatMap((p) => p.hand);
  assert.equal(dealt.length, 18);
  assert.equal(new Set(dealt).size, 18, 'no card may be dealt twice');
  for (const c of s.envelope) assert.ok(!dealt.includes(c), 'envelope cards never appear in a hand');
  assert.equal(s.players.reduce((n, p) => n + p.hand.length, 0), 18);
  // Evenly as possible: 18 / 4 = 4.5 → 5,5,4,4
  const sizes = s.players.map((p) => p.hand.length).sort();
  assert.deepEqual(sizes, [4, 4, 5, 5]);
});

test('Miss Scarlet always moves first, then clockwise', () => {
  let s = lobbyWithBots(6, 7);
  assert.equal(playerById(s, s.players[s.turnIndex].id)?.suspectId, 'scarlet');
  const order: string[] = [];
  for (let i = 0; i < 6; i++) {
    order.push(s.players[s.turnIndex].suspectId);
    s = apply(s, { type: 'ROLL', playerId: s.players[s.turnIndex].id });
    if (s.legalMoves.length) {
      s = apply(s, { type: 'MOVE', playerId: s.players[s.turnIndex].id, to: s.legalMoves[0].pos });
    }
    const me = s.players[s.turnIndex].id;
    if (s.phase === 'SUGGEST') s = apply(s, { type: 'SKIP_SUGGEST', playerId: me });
    if (s.phase === 'ACCUSE') s = apply(s, { type: 'SKIP_ACCUSE', playerId: me });
    if (s.phase === 'DISPROVE' && s.pendingPrompt) {
      // the active player is not the queried one unless everyone holds cards
      s = apply(s, {
        type: 'DISPROVE',
        playerId: s.pendingPrompt.playerId,
        promptId: s.pendingPrompt.id,
        cardId: s.pendingPrompt.options[0],
      });
    }
    if (s.phase === 'END_TURN' || s.phase === 'ACCUSE') s = apply(s, { type: 'END_TURN', playerId: me });
  }
  assert.deepEqual(order, ['scarlet', 'mustard', 'white', 'green', 'peacock', 'plum']);
});

test('dice are always 2d6 and set the exact number of pips', () => {
  let s = lobbyWithBots(3, 4242);
  for (let i = 0; i < 8; i++) {
    const id = s.players[s.turnIndex].id;
    s = apply(s, { type: 'ROLL', playerId: id });
    const [a, b] = s.dice as [number, number];
    assert.ok(a >= 1 && a <= 6 && b >= 1 && b <= 6, `dice ${a},${b} out of range`);
    for (const m of s.legalMoves) assert.ok(m.dist <= a + b, 'no move may exceed the roll');
    assert.ok(s.legalMoves.length > 0, 'from a spawn there is always somewhere to go');
    s = apply(s, { type: 'MOVE', playerId: id, to: s.legalMoves[0].pos });
    if (s.phase === 'SUGGEST') s = apply(s, { type: 'SKIP_SUGGEST', playerId: id });
    if (s.phase === 'ACCUSE') s = apply(s, { type: 'SKIP_ACCUSE', playerId: id });
    if (s.phase === 'END_TURN') s = apply(s, { type: 'END_TURN', playerId: id });
    if (s.phase === 'DISPROVE' && s.pendingPrompt) {
      s = apply(s, {
        type: 'DISPROVE',
        playerId: s.pendingPrompt.playerId,
        promptId: s.pendingPrompt.id,
        cardId: s.pendingPrompt.options[0],
      });
      if (s.phase === 'END_TURN') s = apply(s, { type: 'END_TURN', playerId: id });
    }
  }
});

test('hallway occupancy blocks, rooms are shared', () => {
  let s = lobbyWithBots(2, 5150);
  const a = s.players[s.turnIndex];
  s = apply(s, { type: 'ROLL', playerId: a.id });
  const target = s.legalMoves.find((m) => m.pos.kind === 'hall');
  assert.ok(target, 'a hallway move exists');
  s = apply(s, { type: 'MOVE', playerId: a.id, to: target!.pos });
  if (s.phase === 'SUGGEST') s = apply(s, { type: 'SKIP_SUGGEST', playerId: a.id });
  if (s.phase === 'ACCUSE') s = apply(s, { type: 'SKIP_ACCUSE', playerId: a.id });
  if (s.phase === 'END_TURN') s = apply(s, { type: 'END_TURN', playerId: a.id });
  // Second detective rolls and must not be offered the occupied tile.
  const b = s.players[s.turnIndex];
  s = apply(s, { type: 'ROLL', playerId: b.id });
  assert.ok(!s.legalMoves.some((m) => keyOfPos(m.pos) === keyOfPos(target!.pos)), 'occupied tile excluded');
  for (const m of s.legalMoves) {
    if (m.pos.kind === 'hall') {
      assert.ok(
        !(m.pos.x === (target!.pos as any).x && m.pos.y === (target!.pos as any).y),
        'no move may land on another detective',
      );
    }
  }
});

test('spawn positions match the authentic perimeter tiles', () => {
  const s = lobbyWithBots(6, 3);
  for (const p of s.players) {
    const meta = SUSPECTS.find((x) => x.id === p.suspectId)!;
    assert.deepEqual(p.pos, { kind: 'hall', x: meta.spawn.x, y: meta.spawn.y });
    assert.ok(isHall(meta.spawn.x, meta.spawn.y));
  }
});

test('suggestions teleport the named suspect and weapon into the room', () => {
  let s = lobbyWithBots(3, 808);
  // Force the active player into a room for a deterministic suggestion.
  s = { ...s, players: s.players.map((p, i) => (i === s.turnIndex ? { ...p, pos: { kind: 'room' as const, roomId: 'hall' } } : p)) };
  s = apply(s, { type: 'ROLL', playerId: s.players[s.turnIndex].id });
  const id = s.players[s.turnIndex].id;
  s = apply(s, { type: 'MOVE', playerId: id, to: { kind: 'room', roomId: 'hall' } });
  assert.equal(s.phase, 'SUGGEST');
  const weapon = WEAPONS[2].id;
  s = apply(s, { type: 'SUGGEST', playerId: id, suspectId: 'plum', weaponId: weapon });
  assert.equal(s.suspectRooms.plum, 'hall');
  assert.equal(s.weaponLocations[weapon], 'hall');
  assert.ok(s.suggestion);
  assert.equal(s.suggestion?.roomId, 'hall');
  assert.equal(s.queries.length, 1);
});

test('a suggestion may only be made from inside a room', () => {
  const s = lobbyWithBots(3, 11);
  const id = s.players[s.turnIndex].id;
  const res = reduce(s, { type: 'SUGGEST', playerId: id, suspectId: 'plum', weaponId: 'rope' });
  assert.equal(res.ok, false);
});

test('the clockwise query starts with the player to the suggester left', () => {
  let s = lobbyWithBots(4, 606);
  const suggester = s.players[s.turnIndex];
  s = readyToSuggest(s, suggester.id, 'study');
  // Guarantee the first queried detective holds one of the three cards.
  const cards = ['s:plum', 'w:rope', 'r:study'];
  const nextIdx = (s.turnIndex + 1) % s.players.length;
  const clone = structuredClone(s);
  clone.players[nextIdx].hand.push(cards[0]);
  clone.players.forEach((p) => (p.cardCount = p.hand.length));
  const res = reduce(clone, { type: 'SUGGEST', playerId: suggester.id, suspectId: 'plum', weaponId: 'rope' });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.state.pendingPrompt?.playerId, s.players[nextIdx].id, 'query goes left first');
    assert.equal(res.state.phase, 'DISPROVE');
  }
});

test('only the suggester and the disprover ever see the revealed card', () => {
  let s = lobbyWithBots(4, 2024);
  const suggester = s.players[s.turnIndex].id;
  s = readyToSuggest(s, suggester, 'lounge');
  const nextIdx = (s.turnIndex + 1) % s.players.length;
  const clone = structuredClone(s);
  clone.players[nextIdx].hand = ['s:plum'];
  clone.players.forEach((p) => (p.cardCount = p.hand.length));
  let res = reduce(clone, { type: 'SUGGEST', playerId: suggester, suspectId: 'plum', weaponId: 'rope' });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  s = res.state;
  const disprover = s.pendingPrompt!.playerId;
  res = reduce(s, { type: 'DISPROVE', playerId: disprover, promptId: s.pendingPrompt!.id, cardId: 's:plum' });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  s = res.state;

  const seenByOthers = s.players
    .filter((p) => p.id !== suggester && p.id !== disprover)
    .map((p) => maskState(s, p.id));
  for (const view of seenByOthers) {
    assert.equal(view.suggestion?.revealedCardId, null, 'card identity must be masked');
    assert.ok(!view.reveals.some((r) => r.cardId === 's:plum'), 'other detectives get a boolean, not the card');
    assert.ok(!view.hand.includes('s:plum'));
    // The suggestion trio itself is announced aloud at the table, so it may appear;
    // what must never travel is the identity of the card that was actually shown.
    assert.ok(!JSON.stringify(view).includes('"revealedCardId":"s:plum"'), 'the shown card must stay hidden');
    assert.ok(
      !view.queries.some((q) => q.disproverId && JSON.stringify(q).includes('"revealedCardId"')),
      'query history never carries a revealed card id',
    );
  }
  const bySuggester = maskState(s, suggester);
  assert.equal(bySuggester.suggestion?.revealedCardId, 's:plum');
  assert.ok(bySuggester.reveals.some((r) => r.cardId === 's:plum'), 'the suggester learns the card');
});

test('the envelope is masked until the case is over', () => {
  const s = lobbyWithBots(3, 77);
  for (const p of s.players) {
    const view = maskState(s, p.id);
    assert.equal(view.envelope, null);
    assert.ok(!JSON.stringify(view).includes('envelope":['), 'no envelope contents may leak');
  }
  const finished: GameState = { ...s, phase: 'GAME_OVER', winnerId: s.players[0].id };
  const view = maskState(finished, s.players[0].id);
  assert.equal(view.envelope?.length, 3);
});

test('other players\u2019 hands are reduced to a count', () => {
  const s = lobbyWithBots(4, 31);
  const view = maskState(s, s.players[0].id);
  for (const p of view.players) {
    assert.equal((p as any).hand, undefined, 'hands never travel to the client');
    assert.equal(typeof p.cardCount, 'number');
  }
  assert.equal(view.cardCounts[s.players[1].id], s.players[1].hand.length);
  for (const cardId of s.players[1].hand) {
    assert.ok(!JSON.stringify(view).includes(cardId), `card ${cardId} of another player leaked`);
  }
});

test('a disprove prompt is only delivered to the detective who must answer', () => {
  let s = lobbyWithBots(4, 90);
  s = readyToSuggest(s, s.players[s.turnIndex].id, 'kitchen');
  const clone = structuredClone(s);
  const nextIdx = (s.turnIndex + 1) % s.players.length;
  clone.players[nextIdx].hand = ['w:dagger'];
  const res = reduce(clone, { type: 'SUGGEST', playerId: s.players[s.turnIndex].id, suspectId: 'green', weaponId: 'dagger' });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  s = res.state;
  const queried = s.pendingPrompt!.playerId;
  for (const p of s.players) {
    const view = maskState(s, p.id);
    if (p.id === queried) assert.ok(view.prompt, 'the queried detective receives the prompt');
    else assert.equal(view.prompt, null, 'nobody else sees the prompt or its options');
  }
});

test('an unrefuted theory tells the suggester all three cards are sealed away', () => {
  let s = lobbyWithBots(3, 4711);
  const suggester = s.players[s.turnIndex].id;
  s = readyToSuggest(s, suggester, 'hall');
  // Strip every matching card from the other hands so nobody can answer.
  const clone = structuredClone(s);
  for (const p of clone.players) {
    if (p.id === suggester) continue;
    p.hand = p.hand.filter((c) => !['s:white', 'w:wrench', 'r:hall'].includes(c));
    p.cardCount = p.hand.length;
  }
  const res = reduce(clone, { type: 'SUGGEST', playerId: suggester, suspectId: 'white', weaponId: 'wrench' });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  s = res.state;
  assert.equal(s.suggestion?.unrefuted, true);
  assert.equal(s.phase, 'ACCUSE');
  const modal = s.modals.find((m) => m.kind === 'unrefuted' && m.forPlayerId === suggester);
  assert.ok(modal, 'the breakthrough modal is raised for the suggester');
  // The modal lists exactly the three cards that are *not* in the suggester's own hand.
  const holder = playerById(s, suggester)!;
  const expected = ['r:hall', 's:white', 'w:wrench'].filter((c) => !holder.hand.includes(c)).sort();
  assert.deepEqual((modal!.data.cards as string[]).sort(), expected);
  assert.equal(modal!.data.certain, expected.length === 3);
});

test('a correct accusation ends the case; a wrong one eliminates the detective', () => {
  let s = lobbyWithBots(4, 1212);
  const id = s.players[s.turnIndex].id;
  const wrong = ['s:scarlet', 'w:rope', 'r:study'].filter((c) => !s.envelope.includes(c));
  const fake: Action = {
    type: 'ACCUSE',
    playerId: id,
    suspectId: 'scarlet',
    weaponId: 'rope',
    roomId: 'study',
  };
  s = { ...s, phase: 'ACCUSE' };
  if (wrong.length) {
    const bad = reduce(s, fake);
    assert.equal(bad.ok, true);
    if (bad.ok) {
      assert.equal(playerById(bad.state, id)?.eliminated, true);
      assert.equal(bad.state.phase, 'END_TURN');
    }
  }
  // Now accuse correctly from a fresh table.
  let t = lobbyWithBots(4, 1212);
  t = { ...t, phase: 'ACCUSE' };
  const env = t.envelope;
  const good = reduce(t, {
    type: 'ACCUSE',
    playerId: t.players[t.turnIndex].id,
    suspectId: env[0].split(':')[1],
    weaponId: env[1].split(':')[1],
    roomId: env[2].split(':')[1],
  });
  assert.equal(good.ok, true);
  if (good.ok) {
    assert.equal(good.state.phase, 'GAME_OVER');
    assert.equal(good.state.winnerId, t.players[t.turnIndex].id);
  }
});

test('an eliminated detective keeps their cards and still answers queries', () => {
  let s = lobbyWithBots(3, 606);
  const victim = s.players[s.turnIndex];
  s = { ...s, phase: 'ACCUSE' };
  const bad = reduce(s, {
    type: 'ACCUSE',
    playerId: victim.id,
    suspectId: 'scarlet',
    weaponId: 'rope',
    roomId: 'study',
  });
  assert.equal(bad.ok, true);
  if (!bad.ok) return;
  s = bad.state;
  const after = playerById(s, victim.id)!;
  assert.equal(after.eliminated, true);
  assert.equal(after.hand.length, victim.hand.length, 'their cards stay in play');
  // Give the next detective a matching card and make sure the witness is queried.
  const clone = structuredClone(s);
  const alive = clone.players.find((p) => !p.eliminated)!;
  clone.phase = 'SUGGEST';
  clone.turnIndex = clone.players.indexOf(alive);
  alive.pos = { kind: 'room', roomId: 'dining' };
  clone.players.forEach((p) => {
    if (p.id !== victim.id) p.hand = [];
    p.cardCount = p.hand.length;
  });
  const witness = clone.players.find((p) => p.id === victim.id)!;
  witness.hand = ['w:rope'];
  const res = reduce(clone, { type: 'SUGGEST', playerId: alive.id, suspectId: 'green', weaponId: 'rope' });
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.state.pendingPrompt?.playerId, victim.id, 'witnesses still answer queries');
});

test('modal dismissals are remembered and never reopen', () => {
  let s = lobbyWithBots(3, 55);
  const me = s.players[0].id;
  const modalId = s.modals[0].id;
  s = apply(s, { type: 'DISMISS_MODAL', playerId: me, modalId });
  const view = maskState(s, me);
  assert.ok(!view.modals.some((m) => m.id === modalId), 'dismissed modal stays dismissed');
  // A later broadcast still must not resurrect it.
  const later = { ...s, version: s.version + 5 };
  assert.ok(!maskState(later, me).modals.some((m) => m.id === modalId));
  // Other players still have their own copies.
  const other = s.players[1].id;
  if (s.modals.some((m) => m.forPlayerId === other)) {
    assert.ok(maskState(s, other).modals.some((m) => m.forPlayerId === other));
  }
});

test('a full deck of cards is accounted for at all times', () => {
  const s = lobbyWithBots(3, 17);
  const all = new Set(CARDS.map((c) => c.id));
  const inHands = new Set(s.players.flatMap((p) => p.hand));
  const env = new Set(s.envelope);
  assert.equal(inHands.size + env.size, all.size);
  for (const c of inHands) assert.ok(!env.has(c));
});

test('rooms are the crime scene and may never be suggested from a corridor', () => {
  const s0 = lobbyWithBots(2, 2);
  const id = s0.players[s0.turnIndex].id;
  const s = { ...s0, phase: 'SUGGEST' as const };
  const res = reduce(s, { type: 'SUGGEST', playerId: id, suspectId: 'scarlet', weaponId: 'rope' });
  assert.equal(res.ok, false);
  assert.match(res.ok ? '' : res.error, /room/i);
});

test('secret passages link the correct corner rooms', () => {
  let s = lobbyWithBots(2, 314);
  const id = s.players[s.turnIndex].id;
  s = { ...s, players: s.players.map((p) => (p.id === id ? { ...p, pos: { kind: 'room' as const, roomId: 'kitchen' } } : p)) };
  const res = reduce(s, { type: 'SECRET_PASSAGE', playerId: id });
  assert.equal(res.ok, true);
  if (res.ok) {
    const me = playerById(res.state, id)!;
    assert.deepEqual(me.pos, { kind: 'room', roomId: 'study' });
    assert.equal(res.state.phase, 'SUGGEST');
  }
  // A room without a passage refuses.
  const other: GameState = {
    ...s,
    players: s.players.map((p) => (p.id === id ? { ...p, pos: { kind: 'room' as const, roomId: 'ballroom' } } : p)),
  };
  assert.equal(reduce(other, { type: 'SECRET_PASSAGE', playerId: id }).ok, false);
});

test('the murder vault is never a move destination', () => {
  const s = lobbyWithBots(6, 8);
  for (const p of s.players) {
    const staged = { ...s, phase: 'MOVE' as const, turnIndex: s.players.indexOf(p), legalMoves: [] as GameState['legalMoves'] };
    const res = reduce(staged, {
      type: 'MOVE',
      playerId: p.id,
      to: { kind: 'room', roomId: 'cellar' } as any,
    });
    assert.equal(res.ok, false, 'the cellar is sealed');
  }
});
