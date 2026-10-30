// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOJO, findOffers, findPairs, matchWindow, ratingFromCode, type Waiting } from '../../server/dojo.mjs';
import { createRelay, type Relay } from '../../server/relay.mjs';
import { mulberry32 } from '../sim/rng';
import { battleRating, type Fighter } from '../sim/battle';
import { encodeFighter } from '../sim/battlecode';
import { STAT_CAPS } from '../sim/training';
import { DojoSession } from './dojo';
import { LiveError, LiveSession } from './live';

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

  it('starts at ±10%, widens steadily from 10 s to ±35% at 40 s, never below 8 points', () => {
    expect(matchWindow(200, 0)).toBe(20);
    expect(matchWindow(200, 10_000)).toBe(20);
    expect(matchWindow(200, 25_000)).toBeCloseTo(45);
    expect(matchWindow(200, 40_000)).toBeCloseTo(70);
    expect(matchWindow(200, 10 * 60_000)).toBeCloseTo(70);
    expect(matchWindow(30, 0)).toBe(DOJO.minPoints);
  });

  it('pairs the closest ratings first, each player once', () => {
    const pairs = findPairs([at('a', 200), at('b', 210), at('c', 205), at('d', 300)], 0, new Map());
    expect(pairs.map(([x, y]) => [x.id, y.id])).toEqual([['a', 'c']]);
  });

  it('only matches distant ratings after waiting long enough', () => {
    const far = [at('a', 200), at('b', 250)];
    expect(findPairs(far, 0, new Map())).toEqual([]);
    expect(findPairs(far, 27_000, new Map())).toEqual([]);
    expect(findPairs(far, 29_000, new Map())).toHaveLength(1);
  });

  it('doesn’t pair the same two pets again right away', () => {
    const recent = new Map([['a|b', 0]]);
    expect(findPairs([at('a', 200), at('b', 200)], 30_000, recent)).toEqual([]);
    expect(findPairs([at('a', 200), at('b', 200)], DOJO.rematchMs + 1, recent)).toHaveLength(1);
  });

  const asks = (id: string, rating: number, joinedAt = 0): Waiting => ({ id, rating, joinedAt, offers: true });

  it('offers far-apart pets to each other once both have waited long enough', () => {
    const far = [asks('a', 54), asks('b', 94)];
    expect(findOffers(far, DOJO.offerAfterMs - 1, new Map(), new Map())).toEqual([]);
    expect(findOffers(far, DOJO.offerAfterMs, new Map(), new Map()).map(([x, y]) => [x.id, y.id])).toEqual([['a', 'b']]);
    // Only once both have waited: b just arrived.
    expect(findOffers([asks('a', 54), asks('b', 94, 1)], DOJO.offerAfterMs, new Map(), new Map())).toEqual([]);
  });

  it('offers the closest first, never to games that can’t answer, nor to someone already asked', () => {
    const now = DOJO.offerAfterMs;
    const pairs = findOffers([asks('a', 20), asks('b', 200), asks('c', 100), asks('d', 90)], now, new Map(), new Map());
    expect(pairs.map(([x, y]) => [x.id, y.id])).toEqual([['c', 'd'], ['a', 'b']]);
    expect(findOffers([asks('a', 54), at('b', 94)], now, new Map(), new Map())).toEqual([]);
    expect(findOffers([asks('a', 54), { ...asks('b', 94), offer: {} }], now, new Map(), new Map())).toEqual([]);
  });

  it('doesn’t ask a pair again for a while after one of them said no', () => {
    const far = [asks('a', 54), asks('b', 94)];
    const declined = new Map([['a|b', DOJO.offerAfterMs]]);
    expect(findOffers(far, DOJO.offerAfterMs + 60_000, new Map(), declined)).toEqual([]);
    expect(findOffers(far, DOJO.offerAfterMs + DOJO.declinedMs, new Map(), declined)).toHaveLength(1);
  });
});

let relay: Relay;
let nodeUrl: string;
/** Offers come after this long in these tests (the PHP relay gets the same through PETHATCH_DOJO_OFFER_AFTER_MS). */
const OFFER_AFTER_MS = 1500;
beforeAll(async () => {
  relay = createRelay({ offerAfterMs: OFFER_AFTER_MS });
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
    const match = new Promise<{ room: string; role: 'host' | 'guest'; foe?: string }>((done, fail) => {
      dojo.onMatch = (room, role, foe) => done({ room, role, foe });
      dojo.onFail = (code) => fail(new Error(code));
    });
    return { dojo, players, match };
  };

  /** Two similar pets enter the dojo; resolves with each one's match, guest first. */
  async function matchedPair(pip: Fighter, mochi: Fighter) {
    const a = enter(pip);
    const b = enter(mochi);
    const [ma, mb] = await Promise.all([a.match, b.match]);
    expect(ma.room).toBe(mb.room);
    expect(new Set([ma.role, mb.role])).toEqual(new Set(['host', 'guest']));
    // Each side hears the other pet's code, so it can check it battles that very pet.
    expect(ma.foe).toBe(encodeFighter(mochi));
    expect(mb.foe).toBe(encodeFighter(pip));
    return ma.role === 'guest' ? { guest: [ma, pip] as const, host: [mb, mochi] as const } : { guest: [mb, mochi] as const, host: [ma, pip] as const };
  }

  it('matches two similar pets into a room where their live battle starts', async () => {
    const { guest: [gm, gf], host: [hm, hf] } = await matchedPair(
      fighter(3, { power: 50, speed: 40, guard: 45, wits: 30 }, 'Pip'),
      fighter(3, { power: 45, speed: 45, guard: 50, wits: 30 }, 'Mochi'),
    );
    // The guest may arrive first: the dojo reserved the room for both.
    const guest = new LiveSession(url, gm.room, 'guest', gf, gm.foe);
    await new Promise((r) => setTimeout(r, 50));
    const host = new LiveSession(url, hm.room, 'host', hf, hm.foe);
    const [x, y] = await Promise.all([host.ready, guest.ready]);
    expect(x.seed).toBe(y.seed);
    host.close();
    guest.close();
  });

  it('stops a pet that was matched as a weak one from fighting as a strong one', async () => {
    const { guest: [gm, gf], host: [hm] } = await matchedPair(
      fighter(3, { power: 30, speed: 30, guard: 30, wits: 30 }, 'Pip'),
      fighter(3, { power: 31, speed: 30, guard: 30, wits: 30 }, 'Mochi'),
    );
    const guest = new LiveSession(url, gm.room, 'guest', gf, gm.foe);
    await new Promise((r) => setTimeout(r, 50));
    // The host registered a weak pet, but brings a strong one.
    const host = new LiveSession(url, hm.room, 'host', fighter(3, { power: 100, speed: 100, guard: 100, wits: 100 }, 'Mochi'));
    await expect(guest.ready).rejects.toBeInstanceOf(LiveError);
    expect(guest.failed?.code).toBe('invalid');
    host.close();
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

  /** A pet waiting in the dojo that answers an uneven offer with `yes`; resolves with its offer, then its match. */
  const answering = (f: Fighter, yes: boolean) => {
    const w = enter(f);
    const offered = new Promise<{ foe: string; rating: number; foeRating: number }>((done) => {
      w.dojo.onOffer = (o) => {
        done(o);
        w.dojo.answer(yes);
      };
    });
    const off = new Promise<void>((done) => (w.dojo.onOfferOff = () => done()));
    return { ...w, offered, off };
  };

  it('offers far-apart pets to each other after a while, and matches them if both say yes', async () => {
    const weak = fighter(1, { power: 4, speed: 2, guard: 17, wits: 11 }, 'Kiwi');
    const strong = fighter(1, { power: 30, speed: 24, guard: 16, wits: 4 }, 'Tofu');
    const a = answering(weak, true);
    const b = answering(strong, true);
    const [oa, ob] = await Promise.all([a.offered, b.offered]);
    expect(oa).toEqual({ foe: encodeFighter(strong), rating: 54, foeRating: 94 });
    expect(ob).toEqual({ foe: encodeFighter(weak), rating: 94, foeRating: 54 });
    const [ma, mb] = await Promise.all([a.match, b.match]);
    expect(ma.room).toBe(mb.room);
    expect(ma.foe).toBe(encodeFighter(strong));
   }, 15_000);

  it('lets both go on waiting when one says no, without asking that pair again', async () => {
    const a = answering(fighter(1, { power: 3, speed: 3, guard: 3, wits: 3 }, 'Bean'), true);
    const b = answering(fighter(1, { power: 30, speed: 30, guard: 30, wits: 30 }, 'Dot'), false);
    await Promise.all([a.offered, b.offered]);
    await Promise.all([a.off, b.off]);
    let asked = false;
    a.dojo.onOffer = () => (asked = true);
    await new Promise((r) => setTimeout(r, OFFER_AFTER_MS + 1500));
    expect(asked).toBe(false);
    a.dojo.close();
    b.dojo.close();
  }, 15_000);

  it('turns away an invalid battle code', async () => {
    const bad = new DojoSession(url, 'not-a-real-battle-code');
    await expect(new Promise((_, fail) => (bad.onFail = fail))).rejects.toBe('bad-request');
  });
});
