/**
 * A connection to the relay. Usually a WebSocket; with the PHP relay (server/php/relay.php), for hosts that
 * can't keep WebSockets open, the same messages go over plain HTTP instead: posted, and picked up by long polling.
 */
export interface Channel {
  onopen: () => void;
  onmessage: (text: string) => void;
  /** The connection ended: closed by either side, refused, or lost. */
  onclose: () => void;
  send(text: string): void;
  close(): void;
}

/** Open the relay's battle rooms or the dojo, with these parameters. An http(s) relay URL means the PHP relay. */
export function openChannel(relayUrl: string, path: 'relay' | 'dojo', params: Record<string, string>): Channel {
  const url = new URL(relayUrl);
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    return new PollChannel(url.toString(), { a: path === 'relay' ? 'join' : 'dojo', ...params });
  }
  // The dojo lives next to the relay: …/relay → …/dojo, keeping any path prefix.
  const ws = new URL(path, relayUrl);
  for (const [key, value] of Object.entries(params)) ws.searchParams.set(key, value);
  return new SocketChannel(ws);
}

class SocketChannel implements Channel {
  onopen = () => {};
  onmessage = (_text: string) => {};
  onclose = () => {};
  private ws: WebSocket;

  constructor(url: URL) {
    this.ws = new WebSocket(url);
    this.ws.onopen = () => this.onopen();
    this.ws.onmessage = (e) => this.onmessage(String(e.data));
    this.ws.onclose = () => this.onclose();
  }

  send(text: string): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(text);
  }

  close(): void {
    this.ws.close();
  }
}

interface Reply {
  id?: string;
  msgs?: [number, string][];
  closed?: boolean;
  /** The relay doesn't know this connection (any more). */
  gone?: boolean;
}

/** Messages per send request, as the PHP relay accepts. */
const MAX_BATCH = 20;
/** A poll that fails is retried this many times (after 1 s, 2 s, …) before the connection counts as lost. */
const POLL_RETRIES = 3;

class PollChannel implements Channel {
  onopen = () => {};
  onmessage = (_text: string) => {};
  onclose = () => {};
  private id: string | null = null;
  /** The last message seen; the relay drops everything up to it. */
  private after = 0;
  private outbox: string[] = [];
  private flushing = false;
  private ended = false;
  private polling = new AbortController();
  private hide = () => this.close();

  constructor(
    private url: string,
    join: Record<string, string>,
  ) {
    // Like a WebSocket, the connection goes with the page, so the other player hears about it right away.
    if (typeof window !== 'undefined') window.addEventListener('pagehide', this.hide);
    void this.run(join);
  }

  private async run(join: Record<string, string>): Promise<void> {
    let reply: Reply;
    try {
      reply = await this.post(join);
    } catch {
      return this.end();
    }
    if (reply.id && this.ended) {
      // Closed while still joining.
      void this.post({ a: 'leave', id: reply.id }, { keepalive: true }).catch(() => {});
      return;
    }
    if (reply.id) {
      this.id = reply.id;
      this.onopen();
    }
    this.take(reply);
    this.flush();
    let failures = 0;
    while (!this.ended) {
      try {
        this.take(await this.post({ a: 'poll', id: this.id, after: this.after }, { signal: this.polling.signal }));
        failures = 0;
      } catch {
        if (this.ended) return;
        if (++failures > POLL_RETRIES) return this.end();
        await new Promise((r) => setTimeout(r, 1000 * failures));
      }
    }
  }

  private async post(body: object, init: RequestInit = {}): Promise<Reply> {
    // Plain text keeps it a simple request: no CORS preflight when the relay is on another host.
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify(body),
      cache: 'no-store',
      ...init,
    });
    if (!res.ok) throw new Error(`Relay answered ${res.status}`);
    return (await res.json()) as Reply;
  }

  private take(reply: Reply): void {
    for (const [seq, text] of reply.msgs ?? []) {
      if (seq <= this.after) continue;
      this.after = seq;
      if (!this.ended) this.onmessage(text);
    }
    if (reply.closed || reply.gone) this.end();
  }

  send(text: string): void {
    if (this.ended) return;
    this.outbox.push(text);
    // Sent a moment later, together with whatever else is sent right now (a goodbye just before close()).
    queueMicrotask(() => this.flush());
  }

  /** Send queued messages one batch at a time, so they arrive in order. */
  private async flush(): Promise<void> {
    if (this.flushing || !this.id) return;
    this.flushing = true;
    while (this.outbox.length && !this.ended) {
      const msgs = this.outbox.splice(0, MAX_BATCH);
      try {
        this.take(await this.post({ a: 'send', id: this.id, msgs }, { keepalive: true }));
      } catch {
        // A lost message would leave both phones waiting for each other.
        this.end();
      }
    }
    this.flushing = false;
  }

  private end(): void {
    if (this.ended) return;
    this.ended = true;
    this.stop();
    this.onclose();
  }

  close(): void {
    if (this.ended) return;
    this.ended = true;
    this.stop();
    if (this.id) {
      const msgs = this.outbox.splice(0);
      void this.post({ a: 'leave', id: this.id, msgs }, { keepalive: true }).catch(() => {});
    }
    setTimeout(() => this.onclose());
  }

  private stop(): void {
    this.polling.abort();
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', this.hide);
  }
}
