/**
 * End-to-end UI test for the primary path: a relay *is* answering, so the room
 * is live and can be shared. Runs in its own process, which gives it a fresh
 * copy of the store singleton.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:5173/',
  pretendToBeVisual: true,
});

const g = globalThis as any;
const define = (key: string, value: unknown) =>
  Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });

define('window', dom.window);
define('document', dom.window.document);
define('navigator', dom.window.navigator);
define('HTMLElement', dom.window.HTMLElement);
define('HTMLCanvasElement', dom.window.HTMLCanvasElement);
define('MouseEvent', dom.window.MouseEvent);
define('Event', dom.window.Event);
define('localStorage', dom.window.localStorage);
define('location', dom.window.location);
define('requestAnimationFrame', dom.window.requestAnimationFrame.bind(dom.window));
define('cancelAnimationFrame', dom.window.cancelAnimationFrame.bind(dom.window));
define('IS_REACT_ACT_ENVIRONMENT', true);
dom.window.HTMLCanvasElement.prototype.getContext = () => null;

/* A socket that simply opens and records whatever the app sends. */
class FakeSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static last: FakeSocket | null = null;
  readyState = 0;
  sent: string[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.last = this;
    setTimeout(() => {
      this.readyState = FakeSocket.OPEN;
      this.onopen?.({});
    }, 0);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = FakeSocket.CLOSED;
  }
  deliver(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
}
define('WebSocket', FakeSocket);

let health = true;
define('fetch', async (url: string) => {
  const target = String(url);
  if (target.includes('/api/health')) {
    if (!health) throw new Error('relay down');
    return { ok: true, json: async () => ({ ok: true }) } as unknown as Response;
  }
  if (target.includes('/exists')) {
    return { ok: true, json: async () => ({ hosted: false, peers: 0 }) } as unknown as Response;
  }
  return { ok: true, json: async () => ({ ok: true }) } as unknown as Response;
});

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
const buttonByText = (needle: string) =>
  [...container.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(needle));
const buttonMatching = (re: RegExp) =>
  [...container.querySelectorAll('button')].find((b) => re.test(b.textContent ?? ''));
const typeInto = async (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
};

before(async () => {
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(App));
  });
  await flush(60);
});

after(async () => {
  await act(async () => {
    root?.unmount();
  });
  store.shutdown();
});

test('a reachable relay makes the tab a live, shareable host', () => {
  assert.equal(store.meta.serverAvailable, true);
  assert.equal(store.meta.mode, 'online-host');
  assert.equal(store.meta.booting, false);
  assert.ok(store.state, 'the lobby exists');
  assert.match(text(), /Join an existing room code|Join with a room code/, 'the join field is offered');
  assert.ok(!/No relay is answering/.test(text()), 'no offline warning when the relay answers');
  assert.match(text(), new RegExp(store.meta.code), 'the room code is on screen');
  assert.ok(FakeSocket.last?.url.includes('/api/ws'), 'the host opened a socket');
  assert.ok(FakeSocket.last?.url.includes('role=host'));
});

test('a guest arriving in the lobby is seated at a free chair', async () => {
  const nameInput = container.querySelector<HTMLInputElement>('input[type="text"]')!;
  await typeInto(nameInput, 'Mrs. Hudson');
  await click(buttonByText('Sit at my own table'));
  assert.match(text(), /The Company Assembled/);
  assert.match(text(), /Mrs. Hudson/);

  await click(buttonByText('Add an AI detective'));
  await click(buttonByText('Add an AI detective'));

  // A second tab joins the room: the relay tells the host, the host seats them.
  const host = FakeSocket.last!;
  await act(async () => {
    host.deliver({ t: 'req', kind: 'join', peer: 'guest-lobby', name: 'Constable Grey' });
  });
  await flush(10);

  const guest = store.hostState!.players.find((p) => p.id === 'guest-lobby');
  assert.ok(guest, 'the guest is seated while the table is still in the lobby');
  assert.equal(guest.name, 'Constable Grey');
  assert.equal(guest.isBot, false);
  assert.equal(guest.isHost, false);
  assert.match(text(), /Constable Grey/, 'and the lobby shows them');

  // Their chair must not be Miss Scarlet's — the host keeps the first move.
  assert.equal(store.hostState!.players[0].id, store.meta.youId);
  assert.equal(store.hostState!.players[0].suspectId, 'scarlet');
});

test('the host can play the whole opening of a case', async () => {
  await click(buttonByText('Seal the envelope & deal'));
  await flush(10);
  assert.match(text(), /YOUR CONFIDENTIAL HAND/);
  await click(buttonByText('Open the notebook'));
  assert.match(text(), /Investigation Ledger/);
  assert.match(text(), /MURDER ENVELOPE SEALED/, 'the board is drawn');

  // Being Miss Scarlet, the first move is ours.
  const roll = buttonMatching(/Roll the dice/);
  assert.ok(roll, `we should move first as Miss Scarlet. Saw: ${text().slice(0, 300)}`);
  await click(roll);
  assert.equal(store.getView().state?.phase, 'MOVE');
  assert.ok((store.getView().state?.legalMoves.length ?? 0) > 0, 'the board lights up');
});

test('a late arrival mid-case watches from the gallery and learns nothing private', async () => {
  const host = FakeSocket.last!;
  const before = store.hostState!.players.length;
  await act(async () => {
    host.deliver({ t: 'req', kind: 'join', peer: 'guest-late', name: 'Late Arrival' });
  });
  await flush(10);

  assert.equal(store.hostState!.players.length, before, 'nobody is seated once the case is under way');

  const toLate = host.sent
    .map((s) => JSON.parse(s))
    .filter((m) => m.t === 'state' && m.to === 'guest-late');
  assert.ok(toLate.length > 0, 'the late arrival still gets a view');
  const view = toLate[toLate.length - 1].envelope;

  assert.equal(view.you, 'guest-late');
  assert.equal(view.envelope, null, 'the murder envelope stays sealed');
  assert.equal(view.hand.length, 0, 'they hold no cards');
  for (const p of view.players) assert.equal(p.hand, undefined, 'no hand travels in the roster');

  // Nothing they are not entitled to may appear anywhere in their payload.
  const raw = JSON.stringify(view);
  for (const other of store.hostState!.players) {
    for (const cardId of other.hand) {
      assert.ok(!raw.includes(`"${cardId}"`), `${cardId} leaked to the gallery`);
    }
  }
  for (const cardId of store.hostState!.envelope) {
    assert.ok(!raw.includes(`"${cardId}"`), `envelope card ${cardId} leaked`);
  }
});

test('a relay that dies mid-case does not take the case down with it', async () => {
  health = false;
  const phaseBefore = store.getView().state?.phase;
  // The table keeps working locally no matter what the network does.
  store.dispatch({ type: 'SET_SCRATCH', playerId: store.meta.youId, text: 'The network may fail; the case will not.' });
  assert.equal(
    store.hostState!.players.find((p) => p.id === store.meta.youId)!.notes,
    'The network may fail; the case will not.',
  );
  assert.equal(store.getView().state?.phase, phaseBefore, 'play is unaffected');
  assert.ok(store.getView().state, 'the board is still there to look at');
  health = true;
});
