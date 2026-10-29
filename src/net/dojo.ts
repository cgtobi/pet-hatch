import type { LiveErrorCode } from './live';

/**
 * Waiting in the dojo: a connection to the relay's matchmaker. It tells how many others are waiting and,
 * once a pet of similar strength turns up, which room to battle in and as which side. Closing the
 * connection is leaving the dojo, so it must only stay open while the player is actually there.
 */
export class DojoSession {
  onPlayers: (others: number) => void = () => {};
  onMatch: (room: string, role: 'host' | 'guest') => void = () => {};
  onFail: (code: LiveErrorCode) => void = () => {};
  private ws: WebSocket;
  private done = false;

  constructor(relayUrl: string, battleCode: string) {
    // The dojo lives next to the relay: …/relay → …/dojo, keeping any path prefix.
    const url = new URL('dojo', relayUrl);
    url.searchParams.set('code', battleCode);
    url.searchParams.set('id', dojoId());
    this.ws = new WebSocket(url);
    let opened = false;
    this.ws.onopen = () => (opened = true);
    this.ws.onmessage = (e) => {
      let m: { t?: string; players?: number; room?: string; role?: string; code?: LiveErrorCode };
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (m.t === 'dojo') this.onPlayers(Number(m.players) || 0);
      else if (m.t === 'match' && m.room && (m.role === 'host' || m.role === 'guest')) {
        this.done = true;
        this.onMatch(m.room, m.role);
      } else if (m.t === 'error') this.finish(m.code ?? 'invalid');
    };
    this.ws.onclose = () => this.finish(opened ? 'left' : 'unreachable');
  }

  private finish(code: LiveErrorCode): void {
    if (this.done) return;
    this.done = true;
    this.onFail(code);
  }

  /** Leave the dojo. */
  close(): void {
    this.done = true;
    this.ws.close();
  }
}

/** A random id for this browser session, only so the dojo doesn't pair the same two pets twice in a row. */
function dojoId(): string {
  try {
    let id = sessionStorage.getItem('pethatch.dojoId');
    if (!id) {
      id = Array.from(crypto.getRandomValues(new Uint32Array(3)), (n) => n.toString(36)).join('');
      sessionStorage.setItem('pethatch.dojoId', id);
    }
    return id;
  } catch {
    return Array.from(crypto.getRandomValues(new Uint32Array(3)), (n) => n.toString(36)).join('');
  }
}
