import { movesFor, type Fighter, type MoveId, type SideKey } from '../sim/battle';
import { decodeFighter, encodeFighter } from '../sim/battlecode';

/**
 * Live battles over the relay. Both phones run the same deterministic battle (lockstep), so they only
 * exchange each pet's battle code, half a random seed each, and one move per turn:
 *
 *   hello  { fighter, commit }  – my pet, and a hash of my half of the seed
 *   seed   { part, salt }       – revealed once both hellos are in, so neither side picks the seed
 *   commit { turn, h }          – hash of my move: I can't change it after seeing yours
 *   reveal { turn, move, salt } – sent only after the other commit arrived
 *   sync   { turn, h }          – fingerprint of the battle state after the turn, to catch desyncs
 *   bye                         – I gave up or left
 *
 * The host is always battle side a, the guest side b, on both phones.
 */

export type LiveErrorCode =
  | 'unreachable'
  | 'no-room'
  | 'full'
  | 'taken'
  | 'busy'
  | 'idle'
  | 'rate'
  | 'bad-request'
  /** The other player left (their connection closed). */
  | 'left'
  | 'gave-up'
  /** This player's own connection to the relay closed (network lost, app backgrounded, server gone). */
  | 'disconnected'
  | 'desync'
  | 'invalid'
  | 'timeout';

export class LiveError extends Error {
  constructor(readonly code: LiveErrorCode) {
    super(`Live battle failed: ${code}`);
  }
}

export interface LiveMatch {
  a: Fighter;
  b: Fighter;
  seed: number;
}

type Msg = { t: string; [key: string]: unknown };

const VERSION = 1;
/** Letters and digits that can't be confused (no 0/O, 1/I). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;
/** How long to wait for the other player's move before giving up on them. */
const TURN_TIMEOUT_MS = 3 * 60_000;

export function newRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

/** Accepts a bare room code or an invite link (?live=CODE). */
export function parseRoomCode(input: string): string | null {
  const text = input.trim();
  const code = (text.match(/[?&]live=([A-Za-z0-9]+)/)?.[1] ?? text).toUpperCase();
  return /^[A-Z2-9]{4,8}$/.test(code) ? code : null;
}

/**
 * cyrb53: a fast 53-bit string hash. Not cryptographic, but with a random salt it keeps a move hidden
 * until it is revealed, which is all a friendly game needs (and works without HTTPS, unlike crypto.subtle).
 */
export function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const randomSalt = () => Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) => n.toString(36)).join('');

interface Waiter {
  match: (m: Msg) => boolean;
  resolve: (m: Msg) => void;
  reject: (e: LiveError) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export class LiveSession {
  /** Resolves once both players are connected and agreed on pets and seed. */
  readonly ready: Promise<LiveMatch>;
  readonly side: SideKey;
  /** Called once if the session fails at any point (other player left, server gone, cheating…). */
  onFail: (e: LiveError) => void = () => {};
  /** Called whenever the number of players in the room changes. */
  onPeers: (n: number) => void = () => {};

  private ws: WebSocket;
  private me: Fighter;
  private inbox: Msg[] = [];
  private waiters: Waiter[] = [];
  private failure: LiveError | null = null;
  private opened = false;
  private paired = false;
  private helloSent = false;
  private seedPart = crypto.getRandomValues(new Uint32Array(1))[0];
  private seedSalt = randomSalt();
  private opponent: Fighter | null = null;
  private syncs = new Map<number, { mine?: string; theirs?: string }>();

  constructor(
    relayUrl: string,
    readonly code: string,
    readonly role: 'host' | 'guest',
    me: Fighter,
  ) {
    this.side = role === 'host' ? 'a' : 'b';
    // Use exactly what the other phone will decode, so both run the battle on identical numbers.
    this.me = decodeFighter(encodeFighter(me))!;
    const url = new URL(relayUrl);
    url.searchParams.set('room', code);
    url.searchParams.set('role', role);
    this.ws = new WebSocket(url);
    this.ws.onopen = () => (this.opened = true);
    this.ws.onmessage = (e) => {
      try {
        this.receive(JSON.parse(String(e.data)) as Msg);
      } catch {
        this.fail('invalid');
      }
    };
    // The other player leaving arrives as a room update; our own socket closing means we lost the connection.
    this.ws.onclose = () => this.fail(this.opened ? 'disconnected' : 'unreachable');
    this.ready = this.handshake();
    // Avoid unhandled-rejection noise when nobody awaits `ready` before a failure.
    this.ready.catch(() => {});
  }

  get failed(): LiveError | null {
    return this.failure;
  }

  private send(msg: Msg): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private receive(m: Msg): void {
    switch (m.t) {
      case 'error':
        return this.fail((m.code as LiveErrorCode) ?? 'invalid');
      case 'room': {
        const peers = Number(m.peers);
        this.onPeers(peers);
        if (peers >= 2) {
          this.paired = true;
          if (!this.helloSent) {
            this.helloSent = true;
            this.send({ t: 'hello', v: VERSION, fighter: encodeFighter(this.me), commit: hash(`${this.seedPart}:${this.seedSalt}`) });
          }
        } else if (this.paired) this.fail('left');
        return;
      }
      case 'bye':
        return this.fail('gave-up');
      case 'sync': {
        const entry = this.syncs.get(Number(m.turn)) ?? {};
        entry.theirs = String(m.h);
        this.syncs.set(Number(m.turn), entry);
        return this.checkSync(Number(m.turn));
      }
    }
    const waiter = this.waiters.find((w) => w.match(m));
    if (waiter) {
      this.waiters.splice(this.waiters.indexOf(waiter), 1);
      clearTimeout(waiter.timer);
      waiter.resolve(m);
    } else this.inbox.push(m);
  }

  /** The next message matching `match`, from the inbox or as it arrives. */
  private next(match: (m: Msg) => boolean, timeoutMs?: number): Promise<Msg> {
    if (this.failure) return Promise.reject(this.failure);
    const queued = this.inbox.find(match);
    if (queued) {
      this.inbox.splice(this.inbox.indexOf(queued), 1);
      return Promise.resolve(queued);
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { match, resolve, reject, timer: undefined };
      if (timeoutMs) waiter.timer = setTimeout(() => this.fail('timeout'), timeoutMs);
      this.waiters.push(waiter);
    });
  }

  private fail(code: LiveErrorCode): void {
    if (this.failure) return;
    this.failure = new LiveError(code);
    for (const w of this.waiters) {
      clearTimeout(w.timer);
      w.reject(this.failure);
    }
    this.waiters = [];
    this.onFail(this.failure);
    this.ws.close();
  }

  private async handshake(): Promise<LiveMatch> {
    const hello = await this.next((m) => m.t === 'hello');
    const opponent = hello.v === VERSION ? decodeFighter(String(hello.fighter)) : null;
    if (!opponent) {
      this.fail('invalid');
      throw this.failure;
    }
    this.opponent = opponent;
    this.send({ t: 'seed', part: this.seedPart, salt: this.seedSalt });
    const seed = await this.next((m) => m.t === 'seed', TURN_TIMEOUT_MS);
    if (hash(`${seed.part}:${seed.salt}`) !== hello.commit) {
      this.fail('invalid');
      throw this.failure;
    }
    const shared = (this.seedPart ^ Number(seed.part)) >>> 0;
    return this.side === 'a' ? { a: this.me, b: opponent, seed: shared } : { a: opponent, b: this.me, seed: shared };
  }

  /** Lock in my move for a turn and get the other player's, without either side seeing the other's first. */
  async exchange(turn: number, move: MoveId): Promise<MoveId> {
    const salt = randomSalt();
    this.send({ t: 'commit', turn, h: hash(`${turn}:${move}:${salt}`) });
    const commit = await this.next((m) => m.t === 'commit' && m.turn === turn, TURN_TIMEOUT_MS);
    this.send({ t: 'reveal', turn, move, salt });
    const reveal = await this.next((m) => m.t === 'reveal' && m.turn === turn, TURN_TIMEOUT_MS);
    const theirs = String(reveal.move) as MoveId;
    const allowed = this.opponent ? movesFor(this.opponent) : [];
    if (hash(`${turn}:${theirs}:${reveal.salt}`) !== commit.h || !allowed.includes(theirs)) {
      this.fail('invalid');
      throw this.failure;
    }
    return theirs;
  }

  /** Report the battle state after a turn; a mismatch with the other phone ends the session. */
  sync(turn: number, state: string): void {
    const h = hash(state);
    const entry = this.syncs.get(turn) ?? {};
    entry.mine = h;
    this.syncs.set(turn, entry);
    this.send({ t: 'sync', turn, h });
    this.checkSync(turn);
  }

  private checkSync(turn: number): void {
    const entry = this.syncs.get(turn);
    if (entry?.mine && entry.theirs && entry.mine !== entry.theirs) this.fail('desync');
  }

  /** Leave: tells the other player I gave up (if the battle is still on) and closes the connection. */
  close(giveUp = false): void {
    if (giveUp) this.send({ t: 'bye' });
    this.failure ??= new LiveError('left');
    for (const w of this.waiters) clearTimeout(w.timer);
    this.waiters = [];
    this.ws.close();
  }
}
