/**
 * Transport: a WebSocket when the network allows one, an HTTP long-poll relay
 * when it does not. Both speak exactly the same opaque JSON messages, so the
 * game sync code never needs to know which one is carrying it.
 */

export type TransportStatus = 'connecting' | 'open' | 'polling' | 'closed';
export type NetMessage = Record<string, any>;

export interface Transport {
  send(msg: NetMessage): void;
  close(): void;
  readonly status: TransportStatus;
  attempts: number;
}

interface Options {
  code: string;
  peerId: string;
  role: 'host' | 'client';
  onMessage: (msg: NetMessage) => void;
  onStatus?: (status: TransportStatus) => void;
}

const BACKOFF = [0, 400, 1200, 2500, 5000];

export function createTransport(opts: Options): Transport {
  let status: TransportStatus = 'connecting';
  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let pollAbort: AbortController | null = null;
  const outbox: NetMessage[] = [];

  const setStatus = (s: TransportStatus) => {
    if (status === s) return;
    status = s;
    opts.onStatus?.(s);
  };

  const flush = () => {
    while (outbox.length && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(outbox.shift()));
    }
    if (status === 'polling' && outbox.length) {
      void pollPost(outbox.splice(0, outbox.length));
    }
  };

  async function pollPost(messages: NetMessage[]): Promise<void> {
    try {
      await fetch(`/api/relay/${opts.code}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ peerId: opts.peerId, role: opts.role, messages }),
      });
    } catch {
      /* the poll loop will retry */
    }
  }

  async function pollLoop(): Promise<void> {
    setStatus('polling');
    // Announce ourselves so the host knows we are here.
    await pollPost([{ t: 'req', kind: 'join', peer: opts.peerId }]);
    while (!closed) {
      try {
        const ctrl = new AbortController();
        pollAbort = ctrl;
        const res = await fetch(
          `/api/relay/${opts.code}?peerId=${encodeURIComponent(opts.peerId)}`,
          { signal: ctrl.signal },
        );
        const body = await res.json();
        for (const msg of body?.messages ?? []) opts.onMessage(msg);
      } catch {
        if (closed) return;
        await new Promise((r) => setTimeout(r, 1200));
      }
      if (outbox.length) await pollPost(outbox.splice(0, outbox.length));
    }
  }

  function connect(): void {
    if (closed) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/api/ws?code=${encodeURIComponent(
      opts.code,
    )}&peer=${encodeURIComponent(opts.peerId)}&role=${opts.role}`;
    try {
      ws = new WebSocket(url);
    } catch {
      ws = null;
    }
    if (!ws) {
      void pollLoop();
      return;
    }

    const failTimer = setTimeout(() => {
      // No socket within 4 s — assume a hostile network and fall back.
      if (status === 'connecting') {
        try {
          ws?.close();
        } catch {}
        setStatus('polling');
        void pollLoop();
      }
    }, 4000);

    ws.onopen = () => {
      clearTimeout(failTimer);
      attempt = 0;
      setStatus('open');
      flush();
    };
    ws.onmessage = (ev) => {
      try {
        opts.onMessage(JSON.parse(ev.data));
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
      clearTimeout(failTimer);
      ws = null;
      if (closed) return;
      if (status === 'open') {
        setStatus('connecting');
        attempt++;
        setTimeout(connect, BACKOFF[Math.min(attempt, BACKOFF.length - 1)]);
      } else {
        setStatus('polling');
        void pollLoop();
      }
    };
    ws.onerror = () => {
      /* onclose handles the retry */
    };
  }

  connect();

  return {
    get status() {
      return status;
    },
    get attempts() {
      return attempt;
    },
    send(msg: NetMessage) {
      if (closed) return;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
        return;
      }
      outbox.push(msg);
      if (status === 'polling') flush();
    },
    close() {
      closed = true;
      pollAbort?.abort();
      try {
        ws?.close();
      } catch {}
      setStatus('closed');
    },
  };
}

/** Is the relay reachable at all? Decides between live rooms and local play. */
export async function relayAvailable(timeoutMs = 1500): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch('/api/health', { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    const body = await res.json();
    return !!body?.ok;
  } catch {
    return false;
  }
}

export async function lookupRoom(code: string): Promise<{ hosted: boolean; peers: number }> {
  try {
    const res = await fetch(`/api/room/${encodeURIComponent(code)}/exists`);
    if (!res.ok) return { hosted: false, peers: 0 };
    const body = await res.json();
    return { hosted: !!body.hosted, peers: Number(body.peers ?? 0) };
  } catch {
    return { hosted: false, peers: 0 };
  }
}
