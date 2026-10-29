// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRelay, type Relay } from '../../server/relay.mjs';
import { battleState, createBattle, MAX_TURNS, MOVES, movesFor, playTurn, type Fighter, type MoveId } from '../sim/battle';
import { hash, LiveError, LiveSession, newRoomCode, parseRoomCode } from './live';

let relay: Relay;
let url: string;

beforeAll(async () => {
  relay = createRelay();
  const port = await relay.listen(0, '127.0.0.1');
  url = `ws://127.0.0.1:${port}/relay`;
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
    const prefixed = url.replace('/relay', '/api/hassio_ingress/abc/relay');
    const host = new LiveSession(prefixed, code, 'host', fighter({}));
    const guest = new LiveSession(url, code, 'guest', fighter({}));
    const [a, b] = await Promise.all([host.ready, guest.ready]);
    expect(a.seed).toBe(b.seed);
    host.close();
    guest.close();
  });
});

describe('live battle over the relay', () => {
  it('plays a whole battle in lockstep: both phones see the same result', async () => {
    const code = newRoomCode();
    const host = new LiveSession(url, code, 'host', fighter({ name: 'Pip', type: 'tide' }));
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
    const guest = new LiveSession(url, code, 'guest', fighter({}));
    await Promise.all([host.ready, guest.ready]);
    const hostSees = failureOf(host);
    guest.close(true);
    expect(await hostSees).toBe('gave-up');

    const code2 = newRoomCode();
    const h2 = new LiveSession(url, code2, 'host', fighter({}));
    const g2 = new LiveSession(url, code2, 'guest', fighter({}));
    await Promise.all([h2.ready, g2.ready]);
    const seen = failureOf(h2);
    g2.close();
    expect(await seen).toBe('left');
  });

  it('catches a desync between the two phones', async () => {
    const code = newRoomCode();
    const host = new LiveSession(url, code, 'host', fighter({}));
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
    const guest = new LiveSession(url, code, 'guest', fighter({}));
    await Promise.all([host.ready, guest.ready]);
    // A tampered guest: commits to one move, then reveals another.
    const ws = (guest as unknown as { ws: WebSocket }).ws;
    const exchange = host.exchange(0, 'tackle');
    ws.send(JSON.stringify({ t: 'commit', turn: 0, h: hash('0:tackle:salt') }));
    ws.send(JSON.stringify({ t: 'reveal', turn: 0, move: 'crush', salt: 'salt' }));
    await expect(exchange).rejects.toBeInstanceOf(LiveError);
    expect(host.failed?.code).toBe('invalid');
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
    } finally {
      await web.close();
    }
  });
});
