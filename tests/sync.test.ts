/**
 * Live relay integration: a real HTTP server, a real WebSocket host, a real
 * WebSocket client — plus the long-poll fallback used when upgrades are blocked.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

process.env.PORT = '8899';
const { server } = await import('../server/index.js');

const BASE = 'http://127.0.0.1:8899';
const CODE = 'SYNC';

interface Inbox {
  ws: WebSocket;
  messages: any[];
  waitFor: (pred: (m: any) => boolean, timeout?: number) => Promise<any>;
}

function open(role: 'host' | 'client', peer: string): Promise<Inbox> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:8899/api/ws?code=${CODE}&peer=${peer}&role=${role}`);
    const messages: any[] = [];
    const waiters: { pred: (m: any) => boolean; resolve: (m: any) => void }[] = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      messages.push(msg);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].pred(msg)) {
          waiters.splice(i, 1)[0].resolve(msg);
        }
      }
    });
    ws.on('error', reject);
    ws.on('open', () =>
      resolve({
        ws,
        messages,
        waitFor: (pred, timeout = 4000) =>
          new Promise((res, rej) => {
            const found = messages.find(pred);
            if (found) return res(found);
            const timer = setTimeout(() => rej(new Error('timed out waiting for message')), timeout);
            waiters.push({
              pred,
              resolve: (m) => {
                clearTimeout(timer);
                res(m);
              },
            });
          }),
      }),
    );
  });
}

before(async () => {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('relay server never came up');
});

after(() => {
  server.close();
});

test('health and room lookups answer over HTTP', async () => {
  const health = await (await fetch(`${BASE}/api/health`)).json();
  assert.equal(health.ok, true);

  const unknown = await (await fetch(`${BASE}/api/room/ZZZZ/exists`)).json();
  assert.equal(unknown.hosted, false);

  const host = await open('host', 'host-1');
  await host.waitFor((m) => m.t === 'hello');
  const known = await (await fetch(`${BASE}/api/room/${CODE}/exists`)).json();
  assert.equal(known.hosted, true);
  host.ws.close();
});

test('a client arrival is announced to the host and state flows back', async () => {
  const host = await open('host', 'host-2');
  const client = await open('client', 'client-2');
  await host.waitFor((m) => m.t === 'hello');
  await client.waitFor((m) => m.t === 'hello');

  const join = await host.waitFor((m) => m.t === 'req' && m.kind === 'join' && m.peer === 'client-2');
  assert.equal(join.peer, 'client-2');

  // The host answers with an already-masked envelope — the relay never inspects it.
  const envelope = {
    code: CODE,
    phase: 'LOBBY',
    players: [{ id: 'client-2', cardCount: 3 }],
    hand: [],
    envelope: null,
  };
  host.ws.send(JSON.stringify({ t: 'state', to: 'client-2', envelope, meta: { actionId: 'a1' } }));

  const state = await client.waitFor((m) => m.t === 'state');
  assert.deepEqual(state.envelope, envelope, 'the relay must carry state verbatim');
  assert.equal(state.meta.actionId, 'a1', 'the action id survives the round trip');

  // A client intent travels the other way, stamped with who sent it.
  client.ws.send(JSON.stringify({ t: 'action', action: { type: 'ROLL', playerId: 'client-2' }, actionId: 'a9' }));
  const relayed = await host.waitFor((m) => m.t === 'action');
  assert.equal(relayed.from, 'client-2');
  assert.equal(relayed.actionId, 'a9');
  assert.equal(relayed.action.type, 'ROLL');

  // A wrong claim of identity is stopped by the host's own guard (not the relay);
  // here we simply verify the `from` field is the connection, not the payload.
  client.ws.send(JSON.stringify({ t: 'action', action: { type: 'ROLL', playerId: 'host-2' }, actionId: 'a10' }));
  const spoof = await host.waitFor((m) => m.t === 'action' && m.actionId === 'a10');
  assert.equal(spoof.from, 'client-2');
  assert.notEqual(spoof.from, spoof.action.playerId, 'the relay stamps the real sender');

  client.ws.close();
  const leave = await host.waitFor((m) => m.t === 'req' && m.kind === 'leave' && m.peer === 'client-2');
  assert.equal(leave.kind, 'leave');
  host.ws.close();
});

test('a broadcast reaches every guest without a target', async () => {
  const host = await open('host', 'host-3');
  const a = await open('client', 'guest-a');
  const b = await open('client', 'guest-b');
  await host.waitFor((m) => m.t === 'req' && m.peer === 'guest-b');

  host.ws.send(JSON.stringify({ t: 'state', envelope: { code: CODE, phase: 'ROLL', version: 7 } }));
  const forA = await a.waitFor((m) => m.t === 'state' && m.envelope.version === 7);
  const forB = await b.waitFor((m) => m.t === 'state' && m.envelope.version === 7);
  assert.equal(forA.envelope.version, 7);
  assert.equal(forB.envelope.version, 7);

  a.ws.close();
  b.ws.close();
  host.ws.close();
});

test('the HTTP long-poll relay carries the same messages when sockets are blocked', async () => {
  const POLL = 'POLL';
  // A "host" that only ever uses fetch.
  await fetch(`${BASE}/api/relay/${POLL}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ peerId: 'host-http', role: 'host', messages: [] }),
  });
  // A guest announces itself; the host should learn about it.
  await fetch(`${BASE}/api/relay/${POLL}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ peerId: 'guest-http', role: 'client', messages: [] }),
  });

  const hostInbox = await (
    await fetch(`${BASE}/api/relay/${POLL}?peerId=host-http`)
  ).json();
  const join = hostInbox.messages.find((m: any) => m.t === 'req' && m.kind === 'join');
  assert.ok(join, 'the host is told a guest arrived over HTTP');

  // Host pushes a masked state to that guest.
  await fetch(`${BASE}/api/relay/${POLL}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      peerId: 'host-http',
      role: 'host',
      messages: [{ t: 'state', to: 'guest-http', envelope: { phase: 'MOVE', version: 12 } }],
    }),
  });
  const guestInbox = await (await fetch(`${BASE}/api/relay/${POLL}?peerId=guest-http`)).json();
  const state = guestInbox.messages.find((m: any) => m.t === 'state');
  assert.equal(state.envelope.version, 12);

  // And an intent from the guest reaches the host with its real sender stamped on it.
  await fetch(`${BASE}/api/relay/${POLL}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      peerId: 'guest-http',
      role: 'client',
      messages: [{ t: 'action', action: { type: 'MOVE', playerId: 'guest-http' }, actionId: 'x1' }],
    }),
  });
  const hostInbox2 = await (await fetch(`${BASE}/api/relay/${POLL}?peerId=host-http`)).json();
  const action = hostInbox2.messages.find((m: any) => m.t === 'action');
  assert.equal(action.from, 'guest-http');
  assert.equal(action.actionId, 'x1');
});
