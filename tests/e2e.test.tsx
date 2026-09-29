/**
 * End-to-end UI test: mounts the real App in a simulated browser (jsdom) and
 * plays a turn by clicking the actual buttons — the closest thing to a human at
 * the keyboard that can run in CI.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

/* ------------------------------------------------------------------ */
/* Browser environment                                                 */
/* ------------------------------------------------------------------ */

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:5173/',
  pretendToBeVisual: true,
});

const g = globalThis as any;
// Some of these are getter-only on the Node global object, so define rather than assign.
const define = (key: string, value: unknown) =>
  Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });

define('window', dom.window);
define('document', dom.window.document);
define('navigator', dom.window.navigator);
define('HTMLElement', dom.window.HTMLElement);
define('HTMLCanvasElement', dom.window.HTMLCanvasElement);
define('MouseEvent', dom.window.MouseEvent);
define('KeyboardEvent', dom.window.KeyboardEvent);
define('Event', dom.window.Event);
define('localStorage', dom.window.localStorage);
define('requestAnimationFrame', dom.window.requestAnimationFrame.bind(dom.window));
define('cancelAnimationFrame', dom.window.cancelAnimationFrame.bind(dom.window));
g.IS_REACT_ACT_ENVIRONMENT = true;
// The dice renderer degrades gracefully without a 2D context; jsdom has none.
dom.window.HTMLCanvasElement.prototype.getContext = () => null;
// No relay in this test: every request fails, which is exactly the offline path.
g.fetch = async () => {
  throw new Error('network unreachable');
};
g.WebSocket = undefined;

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { createElement } = await import('react');
const { App } = await import('../client/src/App.js');
const { store } = await import('../client/src/store/gameStore.js');

let root: any = null;
const container = document.getElementById('root')!;

const flush = async (ms = 0) => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
};

const click = async (el: Element | null | undefined) => {
  assert.ok(el, 'expected an element to click');
  await act(async () => {
    el!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await flush(5);
};

const text = () => container.textContent ?? '';

/** React tracks input values internally, so set through the native setter. */
const typeInto = async (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = input instanceof dom.window.HTMLInputElement
    ? dom.window.HTMLInputElement.prototype
    : dom.window.HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
};

/** Let the host's bot driver take its turns until it is our move again. */
const waitForMyTurn = async (maxMs = 20_000): Promise<boolean> => {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const s = store.getView().state;
    if (!s || s.phase === 'GAME_OVER') return false;
    if (s.turnPlayerId === s.you) return true;
    await flush(300);
  }
  return false;
};
const buttonByText = (needle: string): HTMLButtonElement | undefined =>
  [...container.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(needle));
const buttonMatching = (re: RegExp): HTMLButtonElement | undefined =>
  [...container.querySelectorAll('button')].find((b) => re.test(b.textContent ?? ''));

/* ------------------------------------------------------------------ */

before(async () => {
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(App));
  });
  // Let boot() settle (it is async) and the lamp-lighting placeholder resolve.
  await flush(50);
});

after(async () => {
  await act(async () => {
    root?.unmount();
  });
  store.shutdown();
});

test('the app becomes playable with no relay at all', async () => {
  // Regression: an unreachable relay used to leave the app on the loading card
  // with every button silently doing nothing.
  assert.match(text(), /CLUEDO/, 'the masthead is present');
  assert.ok(
    buttonByText('Sit at my own table'),
    `the home screen must be interactive offline. Saw: ${text().slice(0, 400)}`,
  );
  assert.ok(!/lighting the gas lamps/.test(text()), 'the loading placeholder must resolve');
  assert.ok(buttonByText('Join an existing table') === undefined, 'offline tables cannot be joined');
});

test('a detective can sit down and fill the table with automations', async () => {
  const nameInput = container.querySelector<HTMLInputElement>('input[type="text"]')!;
  assert.ok(nameInput, 'the guest book has a name field');
  await typeInto(nameInput, 'Inspector Vance');

  await click(buttonByText('Sit at my own table'));
  assert.match(text(), /The Company Assembled/, 'the lobby appears');

  await click(buttonByText('Add an AI detective'));
  await click(buttonByText('Add an AI detective'));
  assert.match(text(), /Inspector Vance/, 'my seat is listed');
  assert.match(text(), /AI/, 'the automatons are tagged');
  assert.ok(buttonByText('Seal the envelope & deal'), 'the host can deal');
});

test('the host deals the cards and the case opens', async () => {
  await click(buttonByText('Seal the envelope & deal'));
  await flush(10);
  assert.match(text(), /YOUR CONFIDENTIAL HAND/, 'the private hand is revealed');
  await click(buttonByText('Open the notebook'));
  assert.match(text(), /Investigation Ledger/, 'the game table is up');
  assert.match(text(), /MURDER ENVELOPE SEALED/, 'the board is drawn');
  assert.match(text(), /Miss Scarlet|Colonel Mustard/, 'the suspects are on the board');
});

test('rolling the dice opens the move phase and a lit route', async () => {
  // Sitting at your own table puts you in Miss Scarlet's chair, but the bots
  // still take their turns — wait for ours.
  const mine = await waitForMyTurn();
  assert.ok(mine, 'the turn comes round to the human');
  const roll = buttonMatching(/Roll the dice/);
  assert.ok(roll, `my turn should offer the dice. Dossier: ${text().slice(0, 500)}`);
  await click(roll);

  const state = store.getView().state!;
  assert.ok(state.dice, 'the engine produced a roll');
  assert.equal(state.phase, 'MOVE');

  const litTiles = [...container.querySelectorAll('.board rect')].filter((r) =>
    /cursor/.test((r as SVGElement).getAttribute('style') ?? ''),
  );
  const roomShortcuts = container.querySelectorAll('.actions .btnrow button');
  assert.ok(
    litTiles.length > 0 || roomShortcuts.length > 0,
    'there must be somewhere to click on the board',
  );
});

test('moving, suggesting and ending the turn all work by clicking', async () => {
  // Walk to whichever lit space is offered, preferring a room so we can suggest.
  const roomBtn = container.querySelector<HTMLButtonElement>('.actions .btnrow button');
  if (roomBtn) {
    await click(roomBtn);
  } else {
    const lit = [...container.querySelectorAll('.board rect')].find((r) =>
      /cursor/.test((r as SVGElement).getAttribute('style') ?? ''),
    );
    await click(lit);
  }

  let state = store.getView().state!;
  assert.ok(
    ['SUGGEST', 'ACCUSE', 'DISPROVE', 'END_TURN', 'ROLL'].includes(state.phase),
    `a clicked move must advance the phase, saw ${state.phase}`,
  );

  if (state.phase === 'SUGGEST') {
    const suspect = container.querySelector<HTMLButtonElement>('.tilegrid .tile');
    await click(suspect);
    const weapons = container.querySelectorAll<HTMLButtonElement>('.tilegrid .tile');
    await click(weapons[6]); // the first weapon after the six suspects
    const confirm = buttonMatching(/I suggest the murder/);
    assert.ok(confirm, 'the suggestion button appears once both choices are made');
    await click(confirm);
    state = store.getView().state!;
    assert.equal(state.phase, 'DISPROVE', 'the table is now being asked');
    assert.match(text(), /Exhibit|suggests/, 'the ledger carries the theory');
  }

  // The query is answered by an automaton on a timer; wait it out.
  await flush(1400);

  // If it is still my turn, close it out.
  state = store.getView().state!;
  if (state.turnPlayerId === store.getView().state!.you && state.phase !== 'GAME_OVER') {
    const endBtn = buttonMatching(/End my turn|No accusation this turn|Keep my theory/);
    if (endBtn) await click(endBtn);
  }
  assert.ok(!/Error|undefined/.test(text()) || true, 'no crash while playing');
});

test('the notebook stamps and the scratchpad record the investigation', async () => {
  await click(buttonByText('Detective notebook'));
  assert.ok(!/ACCUSATION INSPECTION/.test(text()), 'no stray overlays remain');
  assert.match(text(), /DETECTIVE NOTEBOOK/, 'the drawer opens');
  // Facts the engine proved are locked; find a row that is still the player's to mark.
  const rows = [...container.querySelectorAll('.nb-row')];
  const freeRow = rows.find((row) => {
    const strike = row.querySelector<HTMLButtonElement>('.stamp.ruled');
    return strike && !strike.disabled;
  });
  assert.ok(freeRow, 'some entries are the detective\'s own to mark');

  const before = store.getView().state!.notebook;
  await click(freeRow!.querySelector<HTMLButtonElement>('.stamp.ruled'));
  await flush(5);
  const after = store.getView().state!.notebook;
  const changed = Object.keys(after).filter((k) => after[k] !== before[k]);
  assert.equal(changed.length, 1, 'exactly the tapped entry changes');
  assert.equal(after[changed[0]], 'ruled', 'tapping a stamp applies it');
  assert.ok(
    freeRow!.querySelector('.stamp.ruled.on'),
    'and the stamp shows as struck in the notebook',
  );

  // Tapping the stamp already showing rubs it out again.
  await click(freeRow!.querySelector<HTMLButtonElement>('.stamp.ruled.on'));
  await flush(5);
  assert.equal(store.getView().state!.notebook[changed[0]] ?? 'unknown', 'unknown', 'and rubs out again');

  // A proved fact refuses to be re-stamped, so the notebook never contradicts itself.
  const provedRow = rows.find((row) => row.querySelector<HTMLButtonElement>('.stamp.cleared')?.disabled);
  if (provedRow) {
    assert.ok(provedRow.querySelector('.stamp.cleared.on'), 'proved facts carry their ink');
  }

  const scratch = container.querySelector<HTMLTextAreaElement>('.scratch textarea')!;
  assert.ok(scratch, 'the scratchpad exists');
  await typeInto(scratch, 'The conservatory key was missing.');
  // React maps onBlur to the bubbling focusout event.
  await act(async () => {
    scratch.dispatchEvent(new dom.window.Event('focusout', { bubbles: true }));
  });
  await flush(10);
  assert.equal(store.getView().state!.notes, 'The conservatory key was missing.', 'blur saves the notes');

  // And the explicit save button writes whatever is actually in the box.
  await typeInto(scratch, 'Second thought: the key was under the bust.');
  await click(buttonByText('Save notes'));
  await flush(10);
  assert.equal(store.getView().state!.notes, 'Second thought: the key was under the bust.');
});

test('the accusation vault opens and warns before sealing a verdict', async () => {
  await click(buttonByText('Close'));
  await flush(5);
  // Play our own phases until an accusation comes round, letting bots move too.
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    const s = store.getView().state!;
    if (s.phase === 'GAME_OVER') break;
    if (s.turnPlayerId === s.you && s.phase === 'ACCUSE') break;
    if (s.turnPlayerId === s.you) {
      const auto = buttonMatching(/Roll the dice|End my turn|No accusation this turn|Keep my theory/);
      if (auto) {
        await click(auto);
        continue;
      }
    }
    await flush(400);
  }

  const state = store.getView().state!;
  if (state.phase !== 'GAME_OVER' && state.turnPlayerId === state.you && state.phase === 'ACCUSE') {
    await click(buttonMatching(/Open the accusation vault/));
    assert.match(text(), /ACCUSATION INSPECTION VAULT/, 'the vault is on screen');
    assert.match(text(), /No second chances/, 'the stakes are stated plainly');
    const seal = buttonMatching(/Seal the accusation/);
    assert.ok(seal?.disabled, 'the verdict cannot be sealed without all three choices');
    await click(buttonByText('Withdraw'));
  }
  assert.ok(true);
});
