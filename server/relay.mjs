/**
 * Live battle relay: pairs two players by a short room code and forwards their messages.
 * It knows nothing about battles and stores nothing; both phones run the battle themselves.
 *
 * Also serves the built game (dist/) and /relay.json, which tells the game where the relay is,
 * so one `node server/relay.mjs` hosts everything. Run behind HTTPS in production (wss://).
 *
 *   PORT=8787 STATIC_DIR=dist node server/relay.mjs
 */
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { DOJO, findOffers, findPairs, pairKey, ratingFromCode } from './dojo.mjs';

/**
 * The relay's WebSocket path. Matched by suffix, so it also works under a path prefix (e.g. Home Assistant
 * ingress at /api/hassio_ingress/<token>/relay, whether or not the proxy strips the prefix).
 */
const PATH = '/relay';
/** The dojo's WebSocket path (matched by suffix too): waiting players, paired by strength. */
const DOJO_PATH = '/dojo';
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** A room the dojo set up for two matched players closes if they haven't both arrived by then. */
const RESERVED_MS = 30_000;
const DOJO_TICK_MS = 1000;
const ROOM_CODE = /^[A-Z2-9]{4,8}$/;
/** Battle messages are tiny; anything bigger is not from the game. */
const MAX_MESSAGE = 4096;
const MAX_ROOMS = 2000;
/** A room nobody writes to for this long is closed (a forgotten invite, a stalled battle). */
const ROOM_IDLE_MS = 15 * 60_000;
/** Per connection: at most this many messages per window. */
const RATE_LIMIT = { messages: 60, windowMs: 10_000 };
const PING_MS = 30_000;
/**
 * Open connections per visitor (IP address; IPv6 by its /64), so one visitor can't take every room or dojo place.
 * A phone needs one or two. PETHATCH_MAX_PER_IP changes it; 0 turns it off, e.g. when every player arrives through
 * the same proxy.
 */
const MAX_PER_IP = 16;
/**
 * Wrong room codes one visitor may try (an unknown code as guest, a taken one as host) before being turned away
 * for a while, so nobody can guess their way into a friend's battle. Off along with the per-visitor limit.
 */
const MAX_ROOM_MISSES = 10;
const ROOM_MISS_WINDOW_MS = 10 * 60_000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

/**
 * @param {{ staticDir?: string | null, log?: (msg: string) => void, maxPerVisitor?: number, offerAfterMs?: number }} [options]
 */
/**
 * Who is asking, for the per-visitor limit: the IP address, an IPv6 one cut to its /64 (a home or phone gets a
 * whole /64 and can pick any address in it). Exported for tests.
 * @param {string | undefined} address
 */
export function visitorOf(address = '') {
  const ip = address.replace(/^::ffff:(?=\d+\.)/, '');
  if (!ip.includes(':')) return ip;
  // Expand "::" so the first four groups are always the /64.
  const [head, tail = ''] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  return `${groups.slice(0, 4).map((g) => g.toLowerCase().padStart(4, '0')).join(':')}::/64`;
}

function maxPerVisitorFromEnv() {
  const env = process.env.PETHATCH_MAX_PER_IP;
  return env === undefined || env === '' ? MAX_PER_IP : Number(env) || 0;
}

/** Message types only the relay itself sends (errors, room and dojo news, matches and offers). */
const RELAY_TYPES = new Set(['error', 'room', 'dojo', 'match', 'offer', 'offer-off']);

/**
 * Whether a player's message pretends to come from the relay, e.g. a fake error that would end the other
 * player's battle as a loss. Those are dropped instead of forwarded.
 * @param {string} text
 */
export function speaksForRelay(text) {
  try {
    const m = JSON.parse(text);
    return typeof m === 'object' && m !== null && RELAY_TYPES.has(m.t);
  } catch {
    return false;
  }
}

export function createRelay({
  staticDir = null,
  log = () => {},
  maxPerVisitor = maxPerVisitorFromEnv(),
  offerAfterMs = DOJO.offerAfterMs,
} = {}) {
  /** @type {Map<string, { peers: Set<import('ws').WebSocket>, timer: NodeJS.Timeout | undefined }>} */
  const rooms = new Map();
  const root = staticDir ? resolve(staticDir) : null;
  /** Open connections per visitor. */
  const perVisitor = new Map();
  /** Pairs that turned down an uneven offer: pair key → when. */
  const declinedPairs = new Map();
  /** Wrong room codes per visitor: when the window started, and how many. */
  const misses = new Map();
  const missedTooOften = (visitor) => {
    const m = misses.get(visitor);
    return maxPerVisitor > 0 && !!m && Date.now() - m.since < ROOM_MISS_WINDOW_MS && m.count >= MAX_ROOM_MISSES;
  };
  const missed = (ws, visitor, code) => {
    const now = Date.now();
    const m = misses.get(visitor);
    misses.set(visitor, m && now - m.since < ROOM_MISS_WINDOW_MS ? { since: m.since, count: m.count + 1 } : { since: now, count: 1 });
    reject(ws, code);
  };

  /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
  const serve = async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname.endsWith('/relay.json')) {
      res.writeHead(200, { 'content-type': TYPES['.json'], 'cache-control': 'no-store' });
      // Relative to the page, so the game connects through the same prefix it was loaded from.
      res.end(JSON.stringify({ url: 'relay' }));
      return;
    }
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`ok ${rooms.size} rooms\n`);
      return;
    }
    if (!root || (req.method !== 'GET' && req.method !== 'HEAD')) {
      res.writeHead(404).end();
      return;
    }
    // Static files from dist/, never outside it; unknown paths fall back to the game page.
    let path;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      // A malformed %-escape: refuse it here, or the error would take the whole server down.
      res.writeHead(400).end();
      return;
    }
    let file = resolve(join(root, path));
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    } catch {
      file = join(root, 'index.html');
    }
    try {
      const body = await readFile(file);
      const noCache = file.endsWith('sw.js') || file.endsWith('.html') || file.endsWith('version.json');
      res.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        'cache-control': noCache ? 'no-cache' : 'public, max-age=31536000, immutable',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(404).end();
    }
  };
  // Whatever a request throws (a URL that won't parse, say) answers 400 instead of stopping the server.
  const server = createServer((req, res) =>
    serve(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(400);
      res.end();
    }),
  );

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE });

  server.on('upgrade', (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      socket.destroy();
      return;
    }
    const enter = url.pathname.endsWith(PATH) ? enterRoom : url.pathname.endsWith(DOJO_PATH) ? enterDojo : null;
    if (!enter) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const visitor = visitorOf(req.socket.remoteAddress);
      const open = perVisitor.get(visitor) ?? 0;
      if (maxPerVisitor > 0 && open >= maxPerVisitor) return reject(ws, 'busy');
      perVisitor.set(visitor, open + 1);
      ws.once('close', () => {
        const left = (perVisitor.get(visitor) ?? 1) - 1;
        if (left > 0) perVisitor.set(visitor, left);
        else perVisitor.delete(visitor);
      });
      enter(ws, url, visitor);
    });
  });

  const send = (ws, msg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
  const reject = (ws, code) => {
    send(ws, { t: 'error', code });
    ws.close(4000, code);
  };
  const touch = (code, room) => {
    clearTimeout(room.timer);
    room.timer = setTimeout(() => {
      for (const p of room.peers) reject(p, 'idle');
      rooms.delete(code);
    }, ROOM_IDLE_MS);
  };
  const announce = (room) => {
    for (const p of room.peers) send(p, { t: 'room', peers: room.peers.size });
  };

  /** Drop connections that stop answering pings; returns a cleanup for when the socket closes. */
  function keepAlive(ws) {
    let alive = true;
    ws.on('pong', () => (alive = true));
    const ping = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, PING_MS);
    return () => clearInterval(ping);
  }

  /** True while a connection stays within the message rate limit. */
  function rateLimiter() {
    let windowStart = Date.now();
    let count = 0;
    return () => {
      const now = Date.now();
      if (now - windowStart > RATE_LIMIT.windowMs) {
        windowStart = now;
        count = 0;
      }
      return ++count <= RATE_LIMIT.messages;
    };
  }

  function enterRoom(ws, url, visitor) {
    const code = (url.searchParams.get('room') ?? '').toUpperCase();
    const role = url.searchParams.get('role');
    if (!ROOM_CODE.test(code) || (role !== 'host' && role !== 'guest')) return reject(ws, 'bad-request');
    if (missedTooOften(visitor)) return reject(ws, 'busy');
    let room = rooms.get(code);
    if (role === 'host') {
      // A room the dojo reserved is waiting for its host; any other existing room is taken.
      if (room && !(room.reserved && !room.hasHost)) return missed(ws, visitor, 'taken');
      if (!room) {
        if (rooms.size >= MAX_ROOMS) return reject(ws, 'busy');
        room = { peers: new Set(), timer: undefined };
        rooms.set(code, room);
      }
      room.hasHost = true;
    } else {
      if (!room) return missed(ws, visitor, 'no-room');
      if (room.peers.size >= 2) return reject(ws, 'full');
    }
    room.peers.add(ws);
    touch(code, room);
    announce(room);
    log(`room ${code}: ${role} joined (${room.peers.size}/2)`);

    const stopPing = keepAlive(ws);
    const withinRate = rateLimiter();
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      if (!withinRate()) return reject(ws, 'rate');
      touch(code, room);
      const text = data.toString();
      if (speaksForRelay(text)) return;
      for (const p of room.peers) if (p !== ws && p.readyState === p.OPEN) p.send(text);
    });

    ws.on('close', () => {
      stopPing();
      room.peers.delete(ws);
      if (room.peers.size === 0) {
        clearTimeout(room.timer);
        if (rooms.get(code) === room) rooms.delete(code);
      } else announce(room);
      log(`room ${code}: ${role} left`);
    });
  }

  // ---------- dojo ----------

  /** Waiting players by socket. */
  const waiting = new Map();
  /** When two players (by their dojo id) were last matched, to avoid instant rematches. */
  const recent = new Map();

  const announceDojo = () => {
    for (const ws of waiting.keys()) send(ws, { t: 'dojo', players: waiting.size - 1 });
  };

  function enterDojo(ws, url) {
    const battleCode = url.searchParams.get('code');
    const rating = ratingFromCode(battleCode);
    const id = (url.searchParams.get('id') ?? '').slice(0, 40);
    if (rating === null || !id) return reject(ws, 'bad-request');
    if (waiting.size >= DOJO.maxPlayers) return reject(ws, 'busy');
    // Games that can answer uneven offers say so (offers=1); older ones are never asked.
    const entry = { ws, id, rating, code: battleCode, joinedAt: Date.now(), offers: url.searchParams.get('offers') === '1', offer: null };
    waiting.set(ws, entry);
    announceDojo();
    const stopPing = keepAlive(ws);
    const withinRate = rateLimiter();
    // The only thing to say while waiting is the answer to an uneven offer; other chatter only counts toward the rate limit.
    ws.on('message', (data) => {
      if (!withinRate()) return reject(ws, 'rate');
      let m;
      try {
        m = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (m && m.t === 'answer') answerOffer(entry, m.yes === true);
    });
    ws.on('close', () => {
      stopPing();
      // Leaving in the middle of an offer: the other player simply goes on waiting (it's not a no).
      if (entry.offer) cancelOffer(entry, false);
      if (waiting.delete(ws)) announceDojo();
    });
  }

  /**
   * @typedef {{ ws: import('ws').WebSocket, id: string, rating: number, code: string, joinedAt: number, offers: boolean,
   *   offer: { with: DojoEntry, until: number, yes: boolean } | null }} DojoEntry
   */

  /** @param {DojoEntry} entry @param {boolean} yes */
  function answerOffer(entry, yes) {
    const offer = entry.offer;
    if (!offer) return;
    if (!yes) return cancelOffer(entry, true);
    offer.yes = true;
    if (offer.with.offer?.yes) startMatch(entry, offer.with, Date.now());
  }

  /** The offer is off for both: one said no or didn't answer in time (declined), or one left. @param {DojoEntry} entry */
  function cancelOffer(entry, declined) {
    const other = entry.offer?.with;
    for (const e of [entry, other]) {
      if (!e) continue;
      e.offer = null;
      send(e.ws, { t: 'offer-off' });
    }
    if (declined && other) declinedPairs.set(pairKey(entry.id, other.id), Date.now());
  }

  /** Send two dojo players into a fresh room, as host and guest. @param {DojoEntry} a @param {DojoEntry} b */
  function startMatch(a, b, now) {
    const code = newRoomCode();
    const room = { peers: new Set(), timer: undefined, reserved: true, hasHost: false };
    rooms.set(code, room);
    touch(code, room);
    setTimeout(() => {
      if (rooms.get(code) !== room || room.peers.size >= 2) return;
      for (const p of room.peers) reject(p, 'idle');
      clearTimeout(room.timer);
      rooms.delete(code);
    }, RESERVED_MS);
    recent.set(pairKey(a.id, b.id), now);
    for (const [entry, role, other] of [
      [a, 'host', b],
      [b, 'guest', a],
    ]) {
      entry.offer = null;
      waiting.delete(entry.ws);
      // The other pet's code, so the game can check it really battles the pet it was matched with.
      send(entry.ws, { t: 'match', room: code, role, foe: other.code });
      entry.ws.close(1000, 'matched');
    }
    log(`dojo: matched ratings ${a.rating} and ${b.rating} in room ${code}`);
    announceDojo();
  }

  function newRoomCode() {
    let code;
    do {
      code = Array.from({ length: 5 }, () => ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)]).join('');
    } while (rooms.has(code));
    return code;
  }

  /** Pair waiting players and send each pair into a fresh room, as host and guest. */
  /**
   * Pair waiting players close in strength (closest first); then offer the closest of those who've waited long
   * enough to each other, however far apart (see dojo.mjs).
   */
  function matchDojo() {
    const now = Date.now();
    for (const [key, at] of recent) if (now - at > DOJO.rematchMs) recent.delete(key);
    for (const [key, at] of declinedPairs) if (now - at >= DOJO.declinedMs) declinedPairs.delete(key);
    for (const [visitor, m] of misses) if (now - m.since >= ROOM_MISS_WINDOW_MS) misses.delete(visitor);
    // An offer nobody answered in time counts as a no.
    for (const entry of waiting.values()) if (entry.offer && now > entry.offer.until) cancelOffer(entry, true);
    const free = [...waiting.values()].filter((e) => !e.offer);
    if (free.length < 2 || rooms.size >= MAX_ROOMS) return;
    const paired = new Set();
    for (const [a, b] of findPairs(free, now, recent)) {
      startMatch(a, b, now);
      paired.add(a).add(b);
    }
    const rest = free.filter((e) => !paired.has(e));
    for (const [a, b] of findOffers(rest, now, recent, declinedPairs, offerAfterMs)) {
      for (const [me, other] of [
        [a, b],
        [b, a],
      ]) {
        me.offer = { with: other, until: now + DOJO.answerMs, yes: false };
        send(me.ws, { t: 'offer', rating: me.rating, foe: other.code, foeRating: other.rating });
      }
    }
  }
  const dojoTimer = setInterval(matchDojo, DOJO_TICK_MS);

  return {
    server,
    rooms,
    /** Start listening; resolves with the actual port (pass 0 for a random free one). */
    listen(port = 8787, host) {
      return new Promise((done) => server.listen(port, host, () => done(server.address().port)));
    },
    close() {
      clearInterval(dojoTimer);
      for (const room of rooms.values()) clearTimeout(room.timer);
      for (const ws of wss.clients) ws.terminate();
      return new Promise((done) => server.close(() => done()));
    },
  };
}

// Run directly: node server/relay.mjs
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fallback = resolve(import.meta.dirname, '..', 'dist');
  const staticDir = process.env.STATIC_DIR ?? (existsSync(fallback) ? fallback : null);
  // PETHATCH_DOJO_OFFER_AFTER_MS changes when uneven offers start (as for the PHP relay; handy for trying them out).
  const offerEnv = process.env.PETHATCH_DOJO_OFFER_AFTER_MS;
  const offerAfterMs = offerEnv ? Math.max(0, Number(offerEnv) || 0) : undefined;
  const relay = createRelay({ staticDir, offerAfterMs, log: (m) => console.log(m) });
  const port = await relay.listen(Number(process.env.PORT) || 8787, process.env.HOST);
  console.log(`Pet Hatch relay on :${port}${PATH}${staticDir ? `, serving ${staticDir}` : ''}`);
}
