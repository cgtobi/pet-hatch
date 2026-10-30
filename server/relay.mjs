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
import { DOJO, findPairs, pairKey, ratingFromCode } from './dojo.mjs';

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
 * @param {{ staticDir?: string | null, log?: (msg: string) => void }} [options]
 */
export function createRelay({ staticDir = null, log = () => {} } = {}) {
  /** @type {Map<string, { peers: Set<import('ws').WebSocket>, timer: NodeJS.Timeout | undefined }>} */
  const rooms = new Map();
  const root = staticDir ? resolve(staticDir) : null;

  const server = createServer(async (req, res) => {
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
    let file = resolve(join(root, decodeURIComponent(url.pathname)));
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
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const enter = url.pathname.endsWith(PATH) ? enterRoom : url.pathname.endsWith(DOJO_PATH) ? enterDojo : null;
    if (!enter) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => enter(ws, url));
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

  function enterRoom(ws, url) {
    const code = (url.searchParams.get('room') ?? '').toUpperCase();
    const role = url.searchParams.get('role');
    if (!ROOM_CODE.test(code) || (role !== 'host' && role !== 'guest')) return reject(ws, 'bad-request');
    let room = rooms.get(code);
    if (role === 'host') {
      // A room the dojo reserved is waiting for its host; any other existing room is taken.
      if (room && !(room.reserved && !room.hasHost)) return reject(ws, 'taken');
      if (!room) {
        if (rooms.size >= MAX_ROOMS) return reject(ws, 'busy');
        room = { peers: new Set(), timer: undefined };
        rooms.set(code, room);
      }
      room.hasHost = true;
    } else {
      if (!room) return reject(ws, 'no-room');
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
    const rating = ratingFromCode(url.searchParams.get('code'));
    const id = (url.searchParams.get('id') ?? '').slice(0, 40);
    if (rating === null || !id) return reject(ws, 'bad-request');
    if (waiting.size >= DOJO.maxPlayers) return reject(ws, 'busy');
    waiting.set(ws, { ws, id, rating, joinedAt: Date.now() });
    announceDojo();
    const stopPing = keepAlive(ws);
    const withinRate = rateLimiter();
    // Players don't need to say anything while they wait; chatter only counts toward the rate limit.
    ws.on('message', () => withinRate() || reject(ws, 'rate'));
    ws.on('close', () => {
      stopPing();
      if (waiting.delete(ws)) announceDojo();
    });
  }

  function newRoomCode() {
    let code;
    do {
      code = Array.from({ length: 5 }, () => ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)]).join('');
    } while (rooms.has(code));
    return code;
  }

  /** Pair waiting players and send each pair into a fresh room, as host and guest. */
  function matchDojo() {
    const now = Date.now();
    for (const [key, at] of recent) if (now - at > DOJO.rematchMs) recent.delete(key);
    if (waiting.size < 2 || rooms.size >= MAX_ROOMS) return;
    const pairs = findPairs([...waiting.values()], now, recent);
    for (const [a, b] of pairs) {
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
      for (const [entry, role] of [
        [a, 'host'],
        [b, 'guest'],
      ]) {
        waiting.delete(entry.ws);
        send(entry.ws, { t: 'match', room: code, role });
        entry.ws.close(1000, 'matched');
      }
      log(`dojo: matched ratings ${a.rating} and ${b.rating} in room ${code}`);
    }
    if (pairs.length) announceDojo();
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
  const relay = createRelay({ staticDir, log: (m) => console.log(m) });
  const port = await relay.listen(Number(process.env.PORT) || 8787, process.env.HOST);
  console.log(`Pet Hatch relay on :${port}${PATH}${staticDir ? `, serving ${staticDir}` : ''}`);
}
