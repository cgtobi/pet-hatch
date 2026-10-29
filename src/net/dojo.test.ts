// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOJO, findPairs, matchWindow, ratingFromCode, type Waiting } from '../../server/dojo.mjs';
import { createRelay, type Relay } from '../../server/relay.mjs';
import { mulberry32 } from '../sim/rng';
import { battleRating, type Fighter } from '../sim/battle';
import { encodeFighter } from '../sim/battlecode';
import { STAT_CAPS } from '../sim/training';
import { DojoSession } from './dojo';
import { LiveSession } from './live';

function fighter(stage: number, stats: Fighter['stats'], name = 'Pip'): Fighter {
  const form = stage === 1 ? 'child.bright' : stage === 2 ? 'teen.physical' : 'adult.power';
  return { name, type: 'ember', form, stage, stats, discipline: 80, teen: stage >= 2 ? 'teen.physical' : null, seed: 1, wild: false };
}

describe('dojo ratings', () => {
  it('match the game’s battle rating for any valid pet', () => {
    const r = mulberry32(5);
    for (let i = 0; i < 200; i++) {
      const stage = 1 + Math.floor(r() * 4);
      const cap = STAT_CAPS[stage];
      const stat = () => Math.floor(r() * (cap + 1));
      const f = fighter(stage, { power: stat(), speed: stat(), guard: stat(), wits: stat() });
      expect(ratingFromCode(encodeFighter(f))).toBe(battleRating(f));
    }
  });

  it('reject anything that isn’t a valid battle code', () => {
    const code = encodeFighter(fighter(3, { power: 50, speed: 50, guard: 50, wits: 50 }));
    expect(ratingFromCode(code.slice(0, -2) + (code.endsWith('A') ? 'BB' : 'AA'))).toBeNull();
    expect(ratingFromCode('hello')).toBeNull();
    expect(ratingFromCode(encodeFighter(fighter(1, { power: 90, speed: 0, guard: 0, wits: 0 })))).toBeNull();
  });
});

describe('dojo matching', () => {
  const at = (id: string, rating: number, joinedAt = 0): Waiting => ({ id, rating, joinedAt });

  it('starts at ±10% and widens to ±35% while waiting, never below 8 points', () => {
    expect(matchWindow(200, 0)).toBe(20);
    expect(matchWindow(200, 25_000)).toBeCloseTo(40);
    expect(matchWindow(200, 10 * 60_000)).toBe(70);
    expect(matchWindow(30, 0)).toBe(DOJO.minPoints);
  });

  it('pairs the closest ratings first, each player once', () => {
    const pairs = findPairs([at('a', 200), at('b', 210), at('c', 205), at('d', 300)], 0, new Map());
    expect(pairs.map(([x, y]) => [x.id, y.id])).toEqual([['a', 'c']]);
  });

  it('only matches distant ratings after waiting long enough', () => {
    const far = [at('a', 200), at('b', 250)];
    expect(findPairs(far, 0, new Map())).toEqual([]);
    expect(findPairs(far, 45_000, new Map())).toHaveLength(1);
  });

  it('doesn’t pair the same two pets again right away', () => {
    const recent = new Map([['a|b', 0]]);
    expect(findPairs([at('a', 200), at('b', 200)], 30_000, recent)).toEqual([]);
    expect(findPairs([at('a', 200), at('b', 200)], DOJO.rematchMs + 1, recent)).toHaveLength(1);
  });
});

let relay: Relay;
let nodeUrl: string;
beforeAll(async () => {
  relay = createRelay();
  nodeUrl = `ws://127.0.0.1:${await relay.listen(0, '127.0.0.1')}/relay`;
});
afterAll(() => relay.close());

// The PHP relay too, when one is running (npm run test:php).
const relays: [string, () => string][] = [['Node', () => nodeUrl]];
if (process.env.PHP_RELAY_URL) relays.push(['PHP', () => process.env.PHP_RELAY_URL!]);

describe.each(relays)('dojo over the %s relay', (_, relayUrl) => {
  let url: string;
  beforeAll(() => {
    url = relayUrl();
  });

  const enter = (f: Fighter) => {
    const dojo = new DojoSession(url, encodeFighter(f));
    const players: number[] = [];
    dojo.onPlayers = (n) => players.push(n);
    const match = new Promise<{ room: string; role: 'host' | 'guest' }>((done, fail) => {
      dojo.onMatch = (room, role) => done({ room, role });
      dojo.onFail = (code) => fail(new Error(code));
    });
    return { dojo, players, match };
  };

  it('matches two similar pets into a room where their live battle starts', async () => {
    const a = enter(fighter(3, { power: 50, speed: 40, guard: 45, wits: 30 }, 'Pip'));
    const b = enter(fighter(3, { power: 45, speed: 45, guard: 50, wits: 30 }, 'Mochi'));
    const [ma, mb] = await Promise.all([a.match, b.match]);
    expect(ma.room).toBe(mb.room);
    expect(new Set([ma.role, mb.role])).toEqual(new Set(['host', 'guest']));
    // The guest may arrive first: the dojo reserved the room for both.
    const [guestMatch, hostMatch] = ma.role === 'guest' ? [ma, mb] : [mb, ma];
    const guest = new LiveSession(url, guestMatch.room, 'guest', fighter(3, { power: 45, speed: 45, guard: 50, wits: 30 }));
    await new Promise((r) => setTimeout(r, 50));
    const host = new LiveSession(url, hostMatch.room, 'host', fighter(3, { power: 50, speed: 40, guard: 45, wits: 30 }));
    const [x, y] = await Promise.all([host.ready, guest.ready]);
    expect(x.seed).toBe(y.seed);
    host.close();
    guest.close();
  });

  it('keeps pets of very different strength waiting, and leaving updates the count', async () => {
    const strong = enter(fighter(3, { power: 100, speed: 100, guard: 100, wits: 100 }));
    const weak = enter(fighter(1, { power: 2, speed: 2, guard: 2, wits: 2 }));
    await new Promise((r) => setTimeout(r, 1500));
    expect(strong.players.at(-1)).toBe(1);
    weak.dojo.close();
    await new Promise((r) => setTimeout(r, 500));
    expect(strong.players.at(-1)).toBe(0);
    strong.dojo.close();
  });

  it('turns away an invalid battle code', async () => {
    const bad = new DojoSession(url, 'not-a-real-battle-code');
    await expect(new Promise((_, fail) => (bad.onFail = fail))).rejects.toBe('bad-request');
  });
});
