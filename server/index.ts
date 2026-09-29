/**
 * CLUEDO — noir relay server.
 *
 * The game itself is host-authoritative: this process never sees the sealed
 * envelope. It only carries opaque, already-masked state envelopes between the
 * host tab and the other detectives' tabs, and it does so over a WebSocket when
 * one is available and over HTTP long-polling when it is not (locked-down
 * corporate networks, proxies that strip upgrades, …).
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';

/* ------------------------------------------------------------------ */
/* Room registry                                                       */
/* ------------------------------------------------------------------ */

interface Peer {
  id: string;
  role: 'host' | 'client';
  ws?: WebSocket;
  queue: string[]; // long-poll backlog
  waiters: ((payload: string | null) => void)[];
  lastSeen: number;
}

interface Room {
  code: string;
  peers: Map<string, Peer>;
  createdAt: number;
}

const rooms = new Map<string, Room>();

function getRoom(code: string): Room {
  let room = rooms.get(code);
  if (!room) {
    room = { code, peers: new Map(), createdAt: Date.now() };
    rooms.set(code, room);
  }
  return room;
}

/** A peer is reachable if it holds a live socket or is mid long-poll. */
function reachable(peer: Peer): boolean {
  return (!!peer.ws && peer.ws.readyState === 1) || peer.waiters.length > 0;
}

/** Drop peers that have neither a socket nor a poll open (they have gone home). */
function sweep(room: Room): void {
  for (const [id, peer] of room.peers) {
    if (!reachable(peer) && Date.now() - peer.lastSeen > 15_000) room.peers.delete(id);
  }
}

function deliver(peer: Peer, payload: string): void {
  if (peer.ws && peer.ws.readyState === 1) {
    peer.ws.send(payload);
    return;
  }
  const waiter = peer.waiters.shift();
  if (waiter) {
    waiter(payload);
    return;
  }
  peer.queue.push(payload);
  if (peer.queue.length > 60) peer.queue.shift();
}

function sendTo(room: Room, peerId: string, message: unknown): boolean {
  const peer = room.peers.get(peerId);
  if (!peer) return false;
  // `deliver` queues when the peer is between long-polls, so nothing is lost.
  deliver(peer, JSON.stringify(message));
  return true;
}

function sendToHost(room: Room, message: unknown): boolean {
  sweep(room);
  const hosts = [...room.peers.values()].filter((p) => p.role === 'host');
  // A departed host must never shadow the live one; if every host is currently
  // between long-polls we queue for the most recent rather than dropping it.
  const host = hosts.find(reachable) ?? hosts[hosts.length - 1];
  if (!host) return false;
  deliver(host, JSON.stringify(message));
  return true;
}

function pruneRooms(): void {
  const cutoff = Date.now() - 1000 * 60 * 60 * 3;
  for (const [code, room] of rooms) {
    if (room.createdAt < cutoff && [...room.peers.values()].every((p) => p.lastSeen < cutoff)) {
      rooms.delete(code);
    }
  }
}

setInterval(pruneRooms, 1000 * 60 * 5).unref?.();

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

async function readJson(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  });
  res.end(text);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const parts = url.pathname.split('/').filter(Boolean);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
    });
    res.end();
    return;
  }

  // Health — the client uses this to decide if live sync is available.
  if (url.pathname === '/api/health') {
    json(res, 200, { ok: true, rooms: rooms.size, ts: Date.now() });
    return;
  }

  // Does a host for this code already exist? (Decides host vs. client role.)
  if (parts[0] === 'api' && parts[1] === 'room' && parts[3] === 'exists') {
    const room = rooms.get(parts[2]);
    if (room) sweep(room);
    const hosted = !!room && [...room.peers.values()].some((p) => p.role === 'host' && reachable(p));
    json(res, 200, { code: parts[2], hosted, peers: room ? room.peers.size : 0 });
    return;
  }

  // HTTP long-poll fallback transport.
  if (parts[0] === 'api' && parts[1] === 'relay') {
    const code = parts[2] ?? 'unknown';
    const room = getRoom(code);

    if (req.method === 'POST') {
      const body = await readJson(req);
      const peerId = String(body?.peerId ?? '');
      const role = body?.role === 'host' ? 'host' : 'client';
      let peer = room.peers.get(peerId);
      if (!peer) {
        peer = { id: peerId, role, queue: [], waiters: [], lastSeen: Date.now() };
        room.peers.set(peerId, peer);
        if (role === 'client') sendToHost(room, { t: 'req', kind: 'join', peer: peerId });
      }
      peer.lastSeen = Date.now();
      for (const msg of Array.isArray(body?.messages) ? body.messages : []) {
        const target = typeof msg?.to === 'string' ? msg.to : null;
        if (target) sendTo(room, target, msg);
        else if (msg?.t === 'state' || msg?.t === 'req' || msg?.t === 'bye') sendToHost(room, msg);
        else if (msg?.t === 'action') {
          if (!sendToHost(room, { ...msg, from: peerId })) {
            deliver(peer, JSON.stringify({ t: 'error', error: 'host-offline' }));
          }
        }
      }
      json(res, 200, { ok: true });
      return;
    }

    // GET: drain anything queued, otherwise hold the request open briefly.
    const peerId = url.searchParams.get('peerId') ?? '';
    const peer = room.peers.get(peerId);
    if (!peer) {
      json(res, 200, { ok: true, messages: [] });
      return;
    }
    peer.lastSeen = Date.now();
    if (peer.queue.length) {
      const messages = peer.queue.splice(0, peer.queue.length).map((m) => JSON.parse(m));
      json(res, 200, { ok: true, messages });
      return;
    }
    const timeout = setTimeout(() => {
      peer.waiters = peer.waiters.filter((w) => w !== onMessage);
      json(res, 200, { ok: true, messages: [] });
    }, 20_000);
    const onMessage = (payload: string | null) => {
      clearTimeout(timeout);
      if (payload === null) {
        json(res, 200, { ok: true, messages: [] });
        return;
      }
      const rest = peer.queue.splice(0, peer.queue.length).map((m) => JSON.parse(m));
      json(res, 200, { ok: true, messages: [JSON.parse(payload), ...rest] });
    };
    peer.waiters.push(onMessage);
    req.on('close', () => {
      clearTimeout(timeout);
      peer.waiters = peer.waiters.filter((w) => w !== onMessage);
    });
    return;
  }

  // Static client (production build) with SPA fallback.
  if (existsSync(DIST)) {
    const rel = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = path.join(DIST, path.normalize(rel).replace(/^([/\\])+/, ''));
    if (file.startsWith(DIST) && existsSync(file)) {
      const ext = path.extname(file);
      const data = await readFile(file);
      res.writeHead(200, {
        'content-type': MIME[ext] ?? 'application/octet-stream',
        'cache-control': ext === '.html' ? 'no-store' : 'public, max-age=3600',
      });
      res.end(data);
      return;
    }
    const index = await readFile(path.join(DIST, 'index.html'));
    res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
    res.end(index);
    return;
  }

  json(res, 404, { ok: false, error: 'not found' });
});

/* ------------------------------------------------------------------ */
/* WebSocket                                                           */
/* ------------------------------------------------------------------ */

const wss = new WebSocketServer({ server, path: '/api/ws' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const code = url.searchParams.get('code') ?? '';
  const peerId = url.searchParams.get('peer') ?? '';
  const role = url.searchParams.get('role') === 'host' ? 'host' : 'client';
  if (!code || !peerId) {
    ws.close(1008, 'missing identifiers');
    return;
  }

  const room = getRoom(code);
  let peer = room.peers.get(peerId);
  if (!peer) {
    peer = { id: peerId, role, queue: [], waiters: [], lastSeen: Date.now() };
    room.peers.set(peerId, peer);
  }
  peer.role = role;
  peer.ws = ws;
  peer.lastSeen = Date.now();

  // Long-poll waiters are redundant once a socket is live.
  for (const waiter of peer.waiters.splice(0, peer.waiters.length)) waiter(null);

  // Flush anything that piled up while we were offline.
  for (const payload of peer.queue.splice(0, peer.queue.length)) ws.send(payload);

  ws.send(JSON.stringify({ t: 'hello', peerId, role, code }));
  if (role === 'client') sendToHost(room, { t: 'req', kind: 'join', peer: peerId });

  ws.on('message', (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    peer!.lastSeen = Date.now();
    if (msg?.t === 'error') {
      if (typeof msg.to === 'string') sendTo(room, msg.to, msg);
      else deliver(peer!, JSON.stringify(msg));
    } else if (msg?.t === 'state') {
      if (typeof msg.to === 'string') sendTo(room, msg.to, msg);
      else {
        sweep(room);
        for (const p of room.peers.values()) {
          if (p.role === 'client') deliver(p, JSON.stringify(msg));
        }
      }
    } else if (msg?.t === 'action') {
      if (!sendToHost(room, { ...msg, from: peerId })) {
        deliver(peer!, JSON.stringify({ t: 'error', error: 'host-offline' }));
      }
    } else if (msg?.t === 'req' || msg?.t === 'bye') {
      sendToHost(room, { ...msg, peer: msg.peer ?? peerId });
    } else if (msg?.t === 'ping') {
      ws.send(JSON.stringify({ t: 'pong', ts: msg.ts }));
    }
  });

  ws.on('close', () => {
    if (peer!.ws === ws) peer!.ws = undefined;
    peer!.lastSeen = Date.now();
    // Tell the host before the peer disappears from the registry…
    sendToHost(room, { t: 'req', kind: 'leave', peer: peerId });
    // …then forget it entirely so it can never shadow a live connection.
    if (!peer!.waiters.length) room.peers.delete(peerId);
  });
  ws.on('error', () => ws.close());
});

server.listen(PORT, HOST, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  🕯  CLUEDO relay listening on ${HOST}:${PORT}`);
  console.log(`  ↳  health:  ${url}/api/health`);
  console.log(`  ↳  sockets: ws://localhost:${PORT}/api/ws?code=CODE&peer=ID&role=host`);
  console.log(`  ↳  client:  ${existsSync(DIST) ? 'serving ./dist' : 'run `npm run dev` and open the Vite port'}\n`);
});

export { server, rooms };
