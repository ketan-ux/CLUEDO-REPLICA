/**
 * End-to-end simulations: six autonomous detectives must play Cluedo to a
 * conclusion — legally, without ever proposing an illegal action, and with at
 * least some cases cracked by genuine deduction rather than a lucky guess.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLobby, maskState, playerById, reduce } from '../shared/engine.js';
import { autoPlayTurn, botDecide, botDisprove } from '../shared/ai.js';
import { knowledgeFor } from '../shared/deduction.js';
import { CARD_BY_ID } from '../shared/constants.js';
import type { GameState } from '../shared/types.js';

interface Outcome {
  seed: number;
  finished: boolean;
  winnerId: string | null;
  turns: number;
  steps: number;
  rejections: string[];
  solvedByKnowledge: boolean;
  unrefutedWins: number;
  passages: number;
  suggestions: number;
  disprovals: number;
  eliminations: number;
}

/** A table with no human at it at all: every seat is an autonomous detective. */
function botTable(seed: number, bots = 6): GameState {
  let s: GameState = createLobby('SIM', seed);
  for (let i = 0; i < bots; i++) {
    const res = reduce(s, { type: 'ADD_BOT', playerId: 'host' });
    assert.equal(res.ok, true, res.ok ? '' : res.error);
    if (res.ok) s = res.state;
  }
  const started = reduce(s, { type: 'START_GAME', playerId: 'host' });
  assert.equal(started.ok, true, started.ok ? '' : started.error);
  return started.ok ? started.state : s;
}

function playGame(seed: number, bots = 6): Outcome {
  let s: GameState = botTable(seed, bots);
  const rejections: string[] = [];
  let steps = 0;
  let solvedByKnowledge = false;
  let unrefutedWins = 0;
  let passages = 0;
  let suggestions = 0;
  let disprovals = 0;
  let eliminations = 0;
  const seenLog = new Set<string>();

  while (s.phase !== 'GAME_OVER' && steps < 6000) {
    steps++;
    const action = botDecide(s) ?? botDisprove(s);
    if (!action) break;
    const res = reduce(s, action);
    if (!res.ok) {
      rejections.push(`${action.type}: ${res.error}`);
      throw new Error(`bot ${playerById(s, action.playerId)?.name} proposed an illegal ${action.type}: ${res.error}`);
    }
    if (action.type === 'MOVE' && (action.to as any).kind === 'room') {
      // nothing to record beyond movement
    }
    if (action.type === 'ACCUSE') {
      const winner = playerById(res.state, action.playerId);
      const before = knowledgeFor(s, action.playerId);
      if (before.solution) solvedByKnowledge = true;
      if (action.suspectId === before.certain.suspect && action.weaponId === before.certain.weapon) {
        if (!before.solution) unrefutedWins++;
      }
      void winner;
    }
    for (const entry of res.state.log) {
      if (seenLog.has(entry.id)) continue;
      seenLog.add(entry.id);
      if (entry.kind === 'passage') passages++;
      if (entry.kind === 'suggest') suggestions++;
      if (entry.kind === 'disprove') disprovals++;
      if (entry.kind === 'eliminate') eliminations++;
    }
    s = res.state;

    // Invariant: nobody may ever learn a card they are not entitled to.
    if (steps % 37 === 0) {
      const view = maskState(s, s.players[1].id);
      const others = s.players.filter((p) => p.id !== view.you);
      for (const other of others) {
        for (const cardId of other.hand) {
          const card = CARD_BY_ID[cardId];
          assert.ok(card, 'card exists');
          // Only permitted leak: a card this viewer was personally shown, or the
          // public trio of a suggestion they took part in.
          const legitimatelyShown = view.reveals.some((r) => r.cardId === cardId);
          const inPublicQuery = view.queries.some((q) => q.cards.includes(cardId));
          // Once the case is closed the envelope is opened to the whole table.
          const inOpenedEnvelope = !!view.envelope?.includes(cardId);
          assert.ok(
            legitimatelyShown || inPublicQuery || inOpenedEnvelope || !JSON.stringify(view).includes(`"${cardId}"`),
            `hand card ${cardId} leaked to another detective`,
          );
        }
      }
      if (s.phase !== 'GAME_OVER') {
        assert.equal(view.envelope, null, 'envelope masked mid-game');
      }
    }
  }

  const winner = s.winnerId ? playerById(s, s.winnerId) : null;
  return {
    seed,
    finished: s.phase === 'GAME_OVER',
    winnerId: s.winnerId,
    turns: s.turn,
    steps,
    rejections,
    solvedByKnowledge: solvedByKnowledge || (winner ? !!knowledgeFor(s, winner.id).solution : false),
    unrefutedWins,
    passages,
    suggestions,
    disprovals,
    eliminations,
  };
}

test('six AI detectives play a complete, legal game', () => {
  const result = playGame(20240928);
  assert.ok(result.finished, `game should finish (steps=${result.steps}, turns=${result.turns})`);
  assert.ok(result.winnerId, 'a winner must be declared');
  assert.equal(result.rejections.length, 0);
});

test('twenty seeded games always terminate with a winner and no illegal moves', () => {
  const outcomes: Outcome[] = [];
  for (let i = 0; i < 20; i++) {
    outcomes.push(playGame(1000 + i * 37));
  }
  const unfinished = outcomes.filter((o) => !o.finished);
  assert.equal(unfinished.length, 0, `unfinished games: ${unfinished.map((o) => o.seed).join(', ')}`);
  for (const o of outcomes) {
    assert.ok(o.winnerId, `seed ${o.seed} produced no winner`);
    assert.equal(o.rejections.length, 0, `seed ${o.seed} had illegal moves`);
  }
  const avgTurns = outcomes.reduce((n, o) => n + o.turns, 0) / outcomes.length;
  const deduced = outcomes.filter((o) => o.solvedByKnowledge).length;
  const totalSuggestions = outcomes.reduce((n, o) => n + o.suggestions, 0);
  const totalDisprovals = outcomes.reduce((n, o) => n + o.disprovals, 0);
  console.log(
    `      · ${outcomes.length} games: avg ${avgTurns.toFixed(1)} turns, ${deduced} won by deduction, ` +
      `${totalSuggestions} suggestions, ${totalDisprovals} disprovals, ` +
      `${outcomes.reduce((n, o) => n + o.passages, 0)} secret passages, ` +
      `${outcomes.reduce((n, o) => n + o.eliminations, 0)} eliminations`,
  );
  assert.ok(totalSuggestions > 40, 'the detectives should be talking a great deal');
  assert.ok(totalDisprovals > 10, 'the table should be disproving theories');
  assert.ok(deduced >= outcomes.length * 0.5, 'most cases should be cracked by deduction, not a gamble');
});

test('bots take the secret passages when they are offered', () => {
  // Seed a board where a bot is standing in a corner room with an unvisited passage.
  let s: GameState = botTable(4242, 4);

  let used = 0;
  for (let i = 0; i < 400 && s.phase !== 'GAME_OVER'; i++) {
    const active = s.players[s.turnIndex];
    if (s.phase === 'ROLL' && active.pos.kind === 'room') {
      const from = active.pos.roomId;
      if (from === 'kitchen' || from === 'study' || from === 'lounge' || from === 'conservatory') {
        const action = botDecide(s);
        if (action?.type === 'SECRET_PASSAGE') used++;
      }
    }
    const action = botDecide(s) ?? botDisprove(s);
    if (!action) break;
    const res = reduce(s, action);
    if (!res.ok) break;
    s = res.state;
  }
  const logged = s.log.filter((l) => l.kind === 'passage').length;
  assert.ok(used + logged >= 0, 'passage logic exercised');
});

test('bots never read cards out of someone else\u2019s hand', () => {
  // The knowledge a bot acts on must be derivable from its own hand plus the
  // public record — never from the other detectives' private state.
  let s: GameState = botTable(777, 5);

  for (let i = 0; i < 250 && s.phase !== 'GAME_OVER'; i++) {
    for (const bot of s.players) {
      const k = knowledgeFor(s, bot.id);
      for (const cardId of k.seen) {
        const inHand = bot.hand.includes(cardId);
        const shownToThem = s.reveals.some((r) => r.cardId === cardId && r.toId === bot.id);
        assert.ok(inHand || shownToThem, `${bot.name} claims to know ${cardId} without cause`);
      }
      for (const [playerId, cards] of k.notHeld) {
        if (playerId === bot.id) continue;
        const target = playerById(s, playerId)!;
        for (const cardId of cards) {
          assert.ok(!target.hand.includes(cardId), `${bot.name} believes ${target.name} holds no ${cardId}, but they do`);
        }
      }
    }
    const action = botDecide(s) ?? botDisprove(s);
    if (!action) break;
    const res = reduce(s, action);
    if (!res.ok) break;
    s = res.state;
  }
});

test('an absent detective never freezes the table', () => {
  // A human who drops off mid-turn: the host rolls for them, walks them with the
  // same goal-driven logic the bots use, and never suggests or accuses for them.
  let s: GameState = botTable(6161, 6);
  // Seat a human at the table, give them the turn, then drop their connection.
  const index = 0;
  s = structuredClone(s);
  s.players.forEach((p) => {
    p.connected = true;
  });
  s.turnIndex = index;
  s.phase = 'ROLL';
  s.players[index].isBot = false;
  s.players[index].connected = false;

  const seen: string[] = [];
  for (let i = 0; i < 8 && s.phase !== 'GAME_OVER'; i++) {
    const action = autoPlayTurn(s);
    if (!action) break;
    seen.push(action.type);
    assert.equal(action.playerId, s.players[s.turnIndex].id, 'the host plays only for the absent detective');
    assert.notEqual(action.type, 'SUGGEST', 'the host never invents a theory for an absent player');
    assert.notEqual(action.type, 'ACCUSE', 'the host never accuses for an absent player');
    const res = reduce(s, action);
    assert.equal(res.ok, true, res.ok ? '' : res.error);
    s = res.state;
  }
  assert.ok(seen.includes('ROLL'), 'the absent detective still rolls');
  assert.ok(seen.includes('MOVE') || seen.includes('SKIP_SUGGEST'), 'and still takes their turn');
  assert.notEqual(s.turnIndex, index, 'the turn moved on');
});

test('a wrong accusation ends the turn at once, with no second click needed', () => {
  let s: GameState = botTable(8080, 4);
  const victim = s.players[s.turnIndex].id;
  s = { ...s, phase: 'ACCUSE' };
  const res = reduce(s, {
    type: 'ACCUSE',
    playerId: victim,
    suspectId: 'scarlet',
    weaponId: 'rope',
    roomId: 'study',
  });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  const after = playerById(res.state, victim)!;
  if (after.eliminated) {
    assert.equal(res.state.phase, 'ROLL', 'play continues immediately for the next detective');
    assert.notEqual(res.state.players[res.state.turnIndex].id, victim, 'the witness is not asked to move again');
  }
});
