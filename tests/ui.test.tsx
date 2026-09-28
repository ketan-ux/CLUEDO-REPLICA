/**
 * Render smoke tests: the real screens are server-rendered against real masked
 * state, so any crash, bad prop or missing guard shows up here rather than in a
 * player's browser. No DOM is required — effects simply do not run in SSR.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';

const memory = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
};
(globalThis as any).location = { protocol: 'http:', host: 'localhost:5173' };

const { createLobby, maskState, reduce } = await import('../shared/engine.js');
const { App } = await import('../client/src/App.js');
const { Home } = await import('../client/src/screens/Home.js');
const { GameScreen } = await import('../client/src/screens/GameScreen.js');
const { Lobby } = await import('../client/src/screens/Lobby.js');
const { Notebook } = await import('../client/src/components/Notebook.js');
const { AccusationVault, StoreModals, SuggestionBanner } = await import('../client/src/components/Modals.js');
const { store } = await import('../client/src/store/gameStore.js');
const { knowledgeFromMask } = await import('../shared/deduction.js');
type GameState = import('../shared/types.js').GameState;

function botTable(bots = 4, seed = 4242): GameState {
  let s = createLobby('UI', seed);
  for (let i = 0; i < bots; i++) {
    const r = reduce(s, { type: 'ADD_BOT', playerId: 'host' });
    assert.equal(r.ok, true);
    if (r.ok) s = r.state;
  }
  const started = reduce(s, { type: 'START_GAME', playerId: 'host' });
  assert.equal(started.ok, true);
  return started.ok ? started.state : s;
}

const meta = {
  mode: 'local' as const,
  code: 'UI',
  youId: 'host',
  name: 'Host',
  serverAvailable: false,
  connection: 'local' as const,
  notice: null,
  error: null,
  peers: 0,
};

test('the home screen renders', () => {
  const shell = renderToString(createElement(App));
  assert.match(shell, /CLUEDO/, 'the masthead paints before the store boots');

  const html = renderToString(
    createElement(Home, {
      meta: { ...meta, serverAvailable: true, mode: 'online-host' },
      hasPlayers: false,
    }),
  );
  assert.match(html, /Murder Mystery/i);
  assert.match(html, /Sign the guest book/);
  assert.match(html, /Join with a room code/);
  assert.match(html, /party of detectives|Your table code/i);
});

test('the lobby renders every seat, filled and empty', () => {
  let s = createLobby('UI', 1);
  s = reduce(s, { type: 'ADD_BOT', playerId: 'host' }).state as GameState;
  const html = renderToString(createElement(Lobby, { state: maskState(s, 'host'), meta }));
  for (const name of ['Miss Scarlet', 'Colonel Mustard', 'Mrs. White', 'Mr. Green', 'Mrs. Peacock', 'Professor Plum']) {
    assert.ok(html.includes(name), `lobby should list ${name}`);
  }
  assert.match(html, /Add an AI detective/);
});

test('the game table renders the board, the dossier and the ledger', () => {
  const s = botTable(4, 9001);
  const view = maskState(s, s.players[0].id);
  const html = renderToString(
    createElement(GameScreen, { state: view, meta: { ...meta, youId: s.players[0].id } }),
  );
  assert.match(html, /Investigation Ledger/);
  assert.match(html, /Your Confidential Hand/);
  assert.match(html, /MURDER ENVELOPE/);
  assert.match(html, /Conservatory/);
  assert.match(html, /Billiard Room/);
  assert.match(html, /passage to/);
  // The six weapon tokens are drawn from their starting rooms.
  assert.match(html, /weapon:candlestick|Candlestick/i);
});

test('the board renders every space, doorway and the sealed cellar', () => {
  const s = botTable(6, 55);
  const view = maskState(s, s.players[0].id);
  const html = renderToString(createElement(GameScreen, { state: view, meta: { ...meta, youId: s.players[0].id } }));
  const rooms = ['Conservatory', 'Ballroom', 'Kitchen', 'Billiard Room', 'Dining Room', 'Library', 'Hall', 'Lounge', 'Study'];
  for (const r of rooms) assert.ok(html.includes(r.toUpperCase()), `${r} must be drawn`);
  assert.match(html, /THE CELLAR/);
  assert.match(html, /NO ENTRY/);
  // 24 columns x 25 rows of hallway tiles are plotted individually.
  const hallRects = html.match(/<rect[^>]*width="1"[^>]*height="1"/g) ?? [];
  assert.ok(hallRects.length > 100, `hallway tiles plotted (${hallRects.length})`);
});

test('the notebook, the accusation vault and every modal render', () => {
  const s = botTable(3, 77);
  const view = maskState(s, s.players[0].id);
  const nb = renderToString(createElement(Notebook, { state: view, open: true, onClose: () => {} }));
  for (const r of ['Kitchen', 'Ballroom', 'Conservatory', 'Dining Room', 'Billiard Room', 'Library', 'Lounge', 'Hall', 'Study']) {
    assert.ok(nb.includes(r), `notebook lists ${r}`);
  }
  assert.match(nb, /DETECTIVE NOTEBOOK/);
  assert.match(nb, /Notes/);

  const vault = renderToString(
    createElement(AccusationVault, { state: view, open: true, prefill: null, onClose: () => {} }),
  );
  assert.match(vault, /ACCUSATION INSPECTION VAULT/);
  assert.match(vault, /Seal the accusation/);

  const modals = renderToString(createElement(StoreModals, { state: view }));
  assert.match(modals, /YOUR CONFIDENTIAL HAND|UNREFUTED|THE CASE/);

  const banner = renderToString(createElement(SuggestionBanner, { state: view }));
  assert.equal(typeof banner, 'string');
});

test('the case-solved modal opens the three sealed folders', () => {
  // Drive a game to a correct accusation so the reveal modal exists for everyone.
  let s = botTable(4, 31337);
  s = { ...s, phase: 'ACCUSE' };
  const env = s.envelope;
  const res = reduce(s, {
    type: 'ACCUSE',
    playerId: s.players[s.turnIndex].id,
    suspectId: env[0].split(':')[1],
    weaponId: env[1].split(':')[1],
    roomId: env[2].split(':')[1],
  });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  const view = maskState(res.state, res.state.players[0].id);
  assert.equal(view.envelope?.length, 3);

  const html = renderToString(createElement(GameScreen, { state: view, meta: { ...meta, youId: res.state.players[0].id } }));
  assert.match(html, /SOLVED THE MURDER/);
  assert.match(html, /folder/, 'the three wax folders are drawn');
  assert.match(html, /The three sealed folders are broken open/);
});

test('a testimony-free spectator view renders without a hand', () => {
  const s = botTable(6, 12);
  const view = maskState(s, 'stranger-peer');
  assert.equal(view.hand.length, 0);
  const html = renderToString(createElement(GameScreen, { state: view, meta: { ...meta, youId: 'stranger-peer' } }));
  assert.match(html, /watching from the gallery/);
});

test('the notebook deduction engine marks cards it can prove', () => {
  const s = botTable(3, 5);
  const view = maskState(s, s.players[0].id);
  const k = knowledgeFromMask(view);
  // Everything in the viewer's hand is cleared; the envelope contents are not.
  for (const cardId of view.hand) assert.ok(k.clearedItems.has(cardId.split(':')[1]));
  for (const cardId of s.envelope) {
    const item = cardId.split(':')[1];
    if (!view.hand.includes(cardId)) {
      assert.ok(!k.clearedItems.has(item), `${item} cannot be proven innocent`);
    }
  }
});

test('the store exposes an unsubscribe-safe view for React', () => {
  const view = store.getView();
  assert.ok(view.meta);
  const un = store.subscribe(() => {});
  assert.equal(typeof un, 'function');
  un();
});
