import { openChannel, type Channel } from './channel';
import type { LiveErrorCode } from './live';

/**
 * Waiting in the dojo: a connection to the relay's matchmaker. It tells how many others are waiting and,
 * once a pet of similar strength turns up, which room to battle in and as which side. Closing the
 * connection is leaving the dojo, so it must only stay open while the player is actually there.
 */
export class DojoSession {
  onPlayers: (others: number) => void = () => {};
  /** Matched: the room to battle in, this side's role, and the other pet's battle code (if the relay says it). */
  onMatch: (room: string, role: 'host' | 'guest', foe?: string) => void = () => {};
  onFail: (code: LiveErrorCode) => void = () => {};
  private channel: Channel;
  private done = false;

  constructor(relayUrl: string, battleCode: string) {
    this.channel = openChannel(relayUrl, 'dojo', { code: battleCode, id: dojoId() });
    let opened = false;
    this.channel.onopen = () => (opened = true);
    this.channel.onmessage = (text) => {
      let m: { t?: string; players?: number; room?: string; role?: string; foe?: unknown; code?: LiveErrorCode };
      try {
        m = JSON.parse(text);
      } catch {
        return;
      }
      if (m.t === 'dojo') this.onPlayers(Number(m.players) || 0);
      else if (m.t === 'match' && m.room && (m.role === 'host' || m.role === 'guest')) {
        this.done = true;
        this.onMatch(m.room, m.role, typeof m.foe === 'string' ? m.foe : undefined);
      } else if (m.t === 'error') this.finish(m.code ?? 'invalid');
    };
    this.channel.onclose = () => this.finish(opened ? 'left' : 'unreachable');
  }

  private finish(code: LiveErrorCode): void {
    if (this.done) return;
    this.done = true;
    this.onFail(code);
  }

  /** Leave the dojo. */
  close(): void {
    this.done = true;
    this.channel.close();
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
