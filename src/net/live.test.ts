// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createRelay, visitorOf, type Relay } from '../../server/relay.mjs';
import { battleState, createBattle, MAX_TURNS, MOVES, movesFor, playTurn, type Fighter, type MoveId } from '../sim/battle';
import type { Channel } from './channel';
import { commit, LiveError, LiveSession, newRoomCode, parseRoomCode } from './live';

let relay: Relay;
let nodeUrl: string;

beforeAll(async () => {
  relay = createRelay();
  const port = await relay.listen(0, '127.0.0.1');
  nodeUrl = `ws://127.0.0.1:${port}/relay`;
});

afterAll(() => relay.close());

function fighter(over: Partial<Fighter>): Fighter {
  return {
    name: 'Pip',
    type: 'ember',
    form: 'adult.power',
    stage: 3,
    stats: { power: 60, speed: 40, guard: 50, wits: 30 },
    discipline: 30,
    teen: 'teen.physical',
    seed: 5,
    wild: false,
    ...over,
  };
}

/** Wait until a host is in its room, as a friend only joins with the code the host shared. */
const inRoom = (s: LiveSession) => new Promise<void>((done) => (s.onPeers = () => done()));

const failureOf = (s: LiveSession) =>
  new Promise<string>((done) => {
    if (s.failed) done(s.failed.code);
    s.onFail = (e) => done(e.code);
  });

describe('room codes', () => {
  it('makes readable codes and reads them back from links', () => {
    const code = newRoomCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
    expect(parseRoomCode(`https://pets.example/?live=${code.toLowerCase()}`)).toBe(code);
    expect(parseRoomCode('nope!')).toBeNull();
  });
});

describe('relay under a path prefix', () => {
  it('accepts WebSockets on any path ending in /relay', async () => {
    const code = newRoomCode();
    const prefixed = nodeUrl.replace('/relay', '/api/hassio_ingress/abc/relay');
    const host = new LiveSession(prefixed, code, 'host', fighter({}));
    await inRoom(host);
    const guest = new LiveSession(nodeUrl, code, 'guest', fighter({}));
    const [a, b] = await Promise.all([host.ready, guest.ready]);
    expect(a.seed).toBe(b.seed);
    host.close();
    guest.close();
  });
});

// The PHP relay too, when one is running (npm run test:php).
const relays: [string, () => string][] = [['Node', () => nodeUrl]];
if (process.env.PHP_RELAY_URL) relays.push(['PHP', () => process.env.PHP_RELAY_URL!]);

describe.each(relays)('live battle over the %s relay', (_, relayUrl) => {
  let url: string;
  beforeAll(() => {
    url = relayUrl();
  });

  it('plays a whole battle in lockstep: both phones see the same result', async () => {
    const code = newRoomCode();
    const host = new LiveSession(url, code, 'host', fighter({ name: 'Pip', type: 'tide' }));
    await inRoom(host);
    const guest = new LiveSession(url, code, 'guest', fighter({ name: 'Mochi', type: 'bloom', form: 'adult.guard' }));
    const [mh, mg] = await Promise.all([host.ready, guest.ready]);
    expect(mh).toEqual(mg);
    expect(mh.a.name).toBe('Pip');
    expect(mh.b.name).toBe('Mochi');

    // Each phone runs its own copy of the battle.
    const onHost = createBattle(mh.a, mh.b, mh.seed);
    const onGuest = createBattle(mg.a, mg.b, mg.seed);
    const pick = (f: Fighter, turn: number): MoveId => {
      const moves = movesFor(f).filter((m) => MOVES[m].power > 0);
      return moves[turn % moves.length];
    };
    while (!onHost.winner && onHost.turn < MAX_TURNS) {
      const turn = onHost.turn;
      const [guestMove, hostMove] = await Promise.all([
        host.exchange(turn, pick(mh.a, turn)),
        guest.exchange(turn, pick(mg.b, turn)),
      ]);
      playTurn(onHost, pick(mh.a, turn), guestMove);
      playTurn(onGuest, hostMove, pick(mg.b, turn));
      host.sync(turn, battleState(onHost));
      guest.sync(turn, battleState(onGuest));
      expect(battleState(onGuest)).toBe(battleState(onHost));
    }
    expect(onHost.winner).not.toBeNull();
    expect(host.failed).toBeNull();
    host.close();
    guest.close();
  });

  it('turns away a guest with an unknown code and a third player', async () => {
    const lost = new LiveSession(url, 'ZZZZZ', 'guest', fighter({}));
    expect(await failureOf(lost)).toBe('no-room');

    const code = newRoomCode();
    const host = new LiveSession(url, code, 'host', fighter({}));
    await inRoom(host);
    const guest = new LiveSession(url, code, 'guest', fighter({}));
    await Promise.all([host.ready, guest.ready]);
    const third = new LiveSession(url, code, 'guest', fighter({}));
    expect(await failureOf(third)).toBe('full');
    host.close();
    guest.close();
  });

  it('tells the other player when someone gives up or leaves', async () => {
    const code = newRoomCode();
    const host = new LiveSession(url, code, 'host', fighter({}));
    await inRoom(host);
    const guest = new LiveSession(url, code, 'guest', fighter({}));
    await Promise.all([host.ready, guest.ready]);
    const hostSees = failureOf(host);
    guest.close(true);
    expect(await hostSees).toBe('gave-up');

    const code2 = newRoomCode();
    const h2 = new LiveSession(url, code2, 'host', fighter({}));
    await inRoom(h2);
    const g2 = new LiveSession(url, code2, 'guest', fighter({}));
    await Promise.all([h2.ready, g2.ready]);
    const seen = failureOf(h2);
    g2.close();
    expect(await seen).toBe('left');
  });

  it('tells losing your own connection apart from the other player leaving', async () => {
    const code = newRoomCode();
    const host = new LiveSession(url, code, 'host', fighter({}));
    await inRoom(host);
    const guest = new LiveSession(url, code, 'guest', fighter({}));
    await Promise.all([host.ready, guest.ready]);
    const hostSees = failureOf(host);
    const guestSees = failureOf(guest);
    // The host's network drops: its socket closes without a goodbye.
    (host as unknown as { channel: Channel }).channel.close();
    expect(await hostSees).toBe('disconnected');
    expect(await guestSees).toBe('left');
  });

  it('catches a desync between the two phones', async () => {
    const code = newRoomCode();
    const host = new LiveSession(url, code, 'host', fighter({}));
    await inRoom(host);
    const guest = new LiveSession(url, code, 'guest', fighter({}));
    await Promise.all([host.ready, guest.ready]);
    const seen = failureOf(host);
    host.sync(0, 'hp 10');
    guest.sync(0, 'hp 99');
    expect(await seen).toBe('desync');
    guest.close();
  });

  it('rejects a move that was changed after committing to it', async () => {
    const code = newRoomCode();
    const host = new LiveSession(url, code, 'host', fighter({}));
    await inRoom(host);
    const guest = new LiveSession(url, code, 'guest', fighter({}));
    await Promise.all([host.ready, guest.ready]);
    // A tampered guest: commits to one move, then reveals another.
    const ws = (guest as unknown as { channel: Channel }).channel;
    const exchange = host.exchange(0, 'tackle');
    ws.send(JSON.stringify({ t: 'commit', turn: 0, h: commit('0:tackle:saltsaltsalt') }));
    ws.send(JSON.stringify({ t: 'reveal', turn: 0, move: 'crush', salt: 'saltsaltsalt' }));
    await expect(exchange).rejects.toBeInstanceOf(LiveError);
    expect(host.failed?.code).toBe('invalid');
    guest.close();
  });

  it('never passes on a message that pretends to come from the relay', async () => {
    const code = newRoomCode();
    const host = new LiveSession(url, code, 'host', fighter({}));
    await inRoom(host);
    const guest = new LiveSession(url, code, 'guest', fighter({}));
    await Promise.all([host.ready, guest.ready]);
    // A tampered guest tries to end the host's battle as a loss with fake relay news.
    const ws = (guest as unknown as { channel: Channel }).channel;
    ws.send(JSON.stringify({ t: 'error', code: 'disconnected' }));
    ws.send(JSON.stringify({ t: 'room', peers: 1 }));
    ws.send(JSON.stringify({ t: 'match', room: 'ABCDE', role: 'host' }));
    // A real move afterwards still arrives, so the fakes were dropped rather than everything stalling.
    const [hostSees, guestSees] = await Promise.all([host.exchange(0, 'tackle'), guest.exchange(0, 'element')]);
    expect(hostSees).toBe('element');
    expect(guestSees).toBe('tackle');
    expect(host.failed).toBeNull();
    host.close();
    guest.close();
  });
});

describe('relay web server', () => {
  it('serves the game, relay.json and nothing outside the game folder', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'pet-hatch-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Pet Hatch</title>');
    writeFileSync(join(dir, 'app.js'), 'console.log(1)');
    const web = createRelay({ staticDir: dir });
    const port = await web.listen(0, '127.0.0.1');
    const get = (path: string) => fetch(`http://127.0.0.1:${port}${path}`);
    try {
      expect(await (await get('/relay.json')).json()).toEqual({ url: 'relay' });
      // Behind a proxy that keeps a path prefix (Home Assistant ingress), both still work.
      expect(await (await get('/api/hassio_ingress/abc/relay.json')).json()).toEqual({ url: 'relay' });
      expect(await (await get('/')).text()).toContain('Pet Hatch');
      const js = await get('/app.js');
      expect(js.headers.get('content-type')).toContain('javascript');
      expect(await (await get('/some/page')).text()).toContain('Pet Hatch');
      expect((await get('/..%2F..%2Fetc%2Fpasswd')).status).toBe(403);
      // A malformed address is turned away, and the server keeps running.
      expect((await get('/%E0')).status).toBe(400);
      expect((await get('/%')).status).toBe(400);
      expect((await get('/relay.json')).status).toBe(200);
    } finally {
      await web.close();
    }
  });
});

describe('relay limits', () => {
  it('lets one visitor hold only a few connections, and frees them when they close', async () => {
    const limited = createRelay({ maxPerVisitor: 2 });
    const port = await limited.listen(0, '127.0.0.1');
    /** Open a socket as a host of a new room; resolves with the first message, or 'open' after a moment. */
    const connect = () =>
      new Promise<{ ws: WebSocket; first: string }>((done) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/relay?room=${newRoomCode()}&role=host`);
        ws.once('message', (data) => done({ ws, first: data.toString() }));
      });
    try {
      const a = await connect();
      const b = await connect();
      expect(JSON.parse(a.first).t).toBe('room');
      expect(JSON.parse(b.first).t).toBe('room');
      const c = await connect();
      expect(JSON.parse(c.first)).toEqual({ t: 'error', code: 'busy' });
      await new Promise((r) => {
        a.ws.once('close', r);
        a.ws.close();
      });
      await new Promise((r) => setTimeout(r, 50));
      const d = await connect();
      expect(JSON.parse(d.first).t).toBe('room');
      for (const s of [b, c, d]) s.ws.close();
    } finally {
      await limited.close();
    }
  });

  it('turns a visitor away for a while after too many wrong room codes', async () => {
    const strict = createRelay();
    const port = await strict.listen(0, '127.0.0.1');
    const firstMessage = (room: string) =>
      new Promise<{ t: string; code?: string }>((done) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/relay?room=${room}&role=guest`);
        ws.once('message', (data) => {
          done(JSON.parse(data.toString()));
          ws.close();
        });
      });
    try {
      for (let i = 0; i < 10; i++) expect((await firstMessage(newRoomCode())).code).toBe('no-room');
      expect((await firstMessage(newRoomCode())).code).toBe('busy');
    } finally {
      await strict.close();
    }
  });

  it('tells the other player to update when the games speak different versions', async () => {
    const code = newRoomCode();
    const host = new LiveSession(nodeUrl, code, 'host', fighter({}));
    await inRoom(host);
    // A game from before SHA-256 commitments says hello with version 1.
    const old = new WebSocket(`${nodeUrl}?room=${code}&role=guest`);
    old.on('message', (data) => {
      const m = JSON.parse(data.toString());
      if (m.t === 'room' && m.peers === 2) old.send(JSON.stringify({ t: 'hello', v: 1, fighter: 'x', commit: 'y' }));
    });
    expect(await failureOf(host)).toBe('outdated');
    old.close();
  });

  it('counts an IPv6 visitor by its /64 network', () => {
    expect(visitorOf('2001:db8:1:2:3:4:5:6')).toBe(visitorOf('2001:DB8:1:2::9'));
    expect(visitorOf('2001:db8:1:2::1')).not.toBe(visitorOf('2001:db8:1:3::1'));
    expect(visitorOf('::ffff:192.0.2.7')).toBe('192.0.2.7');
    expect(visitorOf('192.0.2.7')).not.toBe(visitorOf('192.0.2.8'));
  });
});
