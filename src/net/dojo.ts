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
  /**
   * Nobody close in strength turned up, so the dojo asks whether to fight a pet far stronger or weaker anyway:
   * its battle code and both ratings. Answer with answer(); onOfferOff follows if it doesn't happen.
   */
  onOffer: (offer: { foe: string; rating: number; foeRating: number }) => void = () => {};
  /** The offer is off: one side said no, didn't answer in time, or left. */
  onOfferOff: () => void = () => {};
  /**
   * Nobody to fight, so a ghost steps in: another player's pet (its battle code, without a name) for the computer to
   * play here, and the ticket that sends its result back to its owner (see sendGhostResult).
   */
  onGhost: (ghost: { foe: string; ticket: string; rating: number; foeRating: number }) => void = () => {};
  onFail: (code: LiveErrorCode) => void = () => {};
  private channel: Channel;
  private done = false;

  /** `ghostKey`: this pet's secret key, so its ghost's results can come back to it. */
  constructor(relayUrl: string, battleCode: string, ghostKey?: string) {
    // offers=1: this game can answer uneven offers; ghosts=1: it can fight ghosts, and its pet may become one.
    const params: Record<string, string> = { code: battleCode, id: dojoId(), offers: '1', ghosts: '1' };
    if (ghostKey) params.key = ghostKey;
    this.channel = openChannel(relayUrl, 'dojo', params);
    let opened = false;
    this.channel.onopen = () => (opened = true);
    this.channel.onmessage = (text) => {
      let m: {
        t?: string;
        players?: number;
        room?: string;
        role?: string;
        foe?: unknown;
        rating?: unknown;
        foeRating?: unknown;
        ticket?: unknown;
        code?: LiveErrorCode;
      };
      try {
        m = JSON.parse(text);
      } catch {
        return;
      }
      if (m.t === 'dojo') this.onPlayers(Number(m.players) || 0);
      else if (m.t === 'match' && m.room && (m.role === 'host' || m.role === 'guest')) {
        this.done = true;
        this.onMatch(m.room, m.role, typeof m.foe === 'string' ? m.foe : undefined);
      } else if (m.t === 'offer' && typeof m.foe === 'string') {
        this.onOffer({ foe: m.foe, rating: Number(m.rating) || 0, foeRating: Number(m.foeRating) || 0 });
      } else if (m.t === 'offer-off') this.onOfferOff();
      else if (m.t === 'ghost' && typeof m.foe === 'string') {
        this.done = true;
        const ticket = typeof m.ticket === 'string' ? m.ticket : '';
        this.onGhost({ foe: m.foe, ticket, rating: Number(m.rating) || 0, foeRating: Number(m.foeRating) || 0 });
      }
      else if (m.t === 'error') this.finish(m.code ?? 'invalid');
    };
    this.channel.onclose = () => this.finish(opened ? 'left' : 'unreachable');
  }

  private finish(code: LiveErrorCode): void {
    if (this.done) return;
    this.done = true;
    this.onFail(code);
  }

  /** Yes or no to the uneven offer. */
  answer(yes: boolean): void {
    this.channel.send(JSON.stringify({ t: 'answer', yes }));
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

/**
 * The relay's ghost desk, over plain HTTP for either relay: the PHP relay takes it like any other request, the
 * Node one at …/ghost next to …/relay. Ghost news is a bonus, so failures come back as null.
 */
async function ghostRequest(relayUrl: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const url = new URL(relayUrl);
  let target: URL;
  if (url.protocol === 'http:' || url.protocol === 'https:') target = url;
  else {
    target = new URL('ghost', relayUrl);
    target.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  }
  try {
    // text/plain needs no CORS preflight; both relays read the body as JSON.
    const res = await fetch(target, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(body) });
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Tell the relay how a ghost battle went, from the ghost's side. */
export async function sendGhostResult(relayUrl: string, ticket: string, ghostWon: boolean): Promise<void> {
  if (ticket) await ghostRequest(relayUrl, { a: 'ghost-result', ticket, won: ghostWon });
}

/** How this pet's ghost did since the last time asked (the relay then starts a new tally), or null if unknown. */
export async function fetchGhostReport(relayUrl: string, key: string): Promise<{ fights: number; wins: number } | null> {
  const r = await ghostRequest(relayUrl, { a: 'ghost-report', key });
  if (!r) return null;
  const fights = Math.max(0, Math.floor(Number(r.fights) || 0));
  return { fights, wins: Math.min(fights, Math.max(0, Math.floor(Number(r.wins) || 0))) };
}

/** A new secret key for a pet's ghost. */
export function newGhostKey(): string {
  return Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) => n.toString(36).padStart(7, '0')).join('');
}
