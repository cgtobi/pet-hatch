// @vitest-environment node
/**
 * The PHP dojo rules (server/php/dojo.php) against the Node ones (server/dojo.mjs, themselves checked against the
 * game's battleRating() in src/net/dojo.test.ts), on the same battle codes and waits. Run by `npm run test:php`,
 * which sets PHP_CHECK_DOJO to the command that runs server/php/check-dojo.php; skipped otherwise.
 */
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { DOJO, findOffers, findPairs, matchWindow, pairKey, ratingFromCode, type Waiting } from '../dojo.mjs';
import type { Fighter } from '../../src/sim/battle';
import { encodeFighter } from '../../src/sim/battlecode';
import { mulberry32 } from '../../src/sim/rng';
import { STAT_CAPS } from '../../src/sim/training';

const command = process.env.PHP_CHECK_DOJO ? (JSON.parse(process.env.PHP_CHECK_DOJO) as string[]) : null;

interface Scene {
  waiting: (Waiting & { offer: unknown })[];
  now: number;
  recent: Record<string, number>;
  declined: Record<string, number>;
}

function php(input: { codes: string[]; windows: [number, number][]; scenes?: Scene[] }): {
  ratings: (number | null)[];
  windows: number[];
  pairs: [number, number][][];
  offers: [number, number][][];
} {
  const [cmd, ...args] = command!;
  const run = spawnSync(cmd, args, { input: JSON.stringify(input), encoding: 'utf8' });
  if (run.status !== 0) throw new Error(run.stderr);
  return JSON.parse(run.stdout);
}

const FORMS = ['child.bright', 'teen.physical', 'adult.power', 'adult.wits'] as const;

/** Valid codes at every stage, from empty to capped stats, and broken ones of every kind. */
function codes(): string[] {
  const rand = mulberry32(42);
  const out: string[] = [];
  for (let stage = 1; stage <= 4; stage++) {
    const cap = STAT_CAPS[stage];
    for (let i = 0; i < 25; i++) {
      const stat = () => (i === 0 ? 0 : i === 1 ? cap : Math.floor(rand() * (cap + 1)));
      const f: Fighter = {
        name: i % 3 ? `Pet ${i}` : 'Mochi ✨',
        type: (['ember', 'tide', 'bloom', 'astral'] as const)[i % 4],
        form: FORMS[stage - 1],
        stage,
        stats: { power: stat(), speed: stat(), guard: stat(), wits: stat() },
        discipline: Math.floor(rand() * 101),
        teen: stage >= 3 ? 'teen.physical' : null,
        seed: Math.floor(rand() * 65536),
        wild: false,
      };
      out.push(encodeFighter(f));
    }
  }
  const good = out[30];
  out.push(
    good.slice(0, -1) + (good.endsWith('A') ? 'B' : 'A'), // wrong checksum
    good.slice(0, -3), // cut short
    good + 'A', // a stray character (base64 that no longer lines up)
    good.slice(0, 15), // too short to be a code
    'x'.repeat(130), // too long
    'hello world',
    '',
    good.replace(/^./, 'B'), // another version byte
  );
  return out;
}

/**
 * Random dojo rooms: a few to a dozen players (some sharing an id, some not taking offers, some already in one),
 * waiting from just now to several minutes, with recent rematches and turned-down offers among them.
 */
function scenes(): Scene[] {
  const rand = mulberry32(7);
  const now = 1_000_000_000;
  const out: Scene[] = [];
  for (let n = 0; n < 60; n++) {
    const count = 2 + Math.floor(rand() * 11);
    const ids = Array.from({ length: count }, (_, i) => `p${rand() < 0.1 ? 0 : i}`);
    const waiting = ids.map((id) => ({
      id,
      // Coarse ratings, so equal gaps (and the order they're taken in) come up often.
      rating: Math.floor(rand() * 12) * 15,
      joinedAt: now - Math.floor(rand() * 4 * DOJO.offerAfterMs),
      offers: rand() < 0.85,
      offer: rand() < 0.1 ? { with: 'x' } : null,
    }));
    const recent: Record<string, number> = {};
    const declined: Record<string, number> = {};
    for (let k = 0; k < count; k++) {
      const [x, y] = [ids[Math.floor(rand() * count)], ids[Math.floor(rand() * count)]];
      const when = now - Math.floor(rand() * 2 * Math.max(DOJO.rematchMs, DOJO.declinedMs));
      (rand() < 0.5 ? recent : declined)[pairKey(x, y)] = when;
    }
    out.push({ waiting, now, recent, declined });
  }
  return out;
}

describe.skipIf(!command)('PHP dojo rules match the Node ones', () => {
  it('rates every battle code the same, and turns away the same broken ones', () => {
    const all = codes();
    const node = all.map((c) => ratingFromCode(c));
    expect(node.filter((r) => r !== null).length).toBeGreaterThan(90);
    expect(php({ codes: all, windows: [] }).ratings).toEqual(node);
  });

  it('widens the match window the same way while waiting', () => {
    const windows: [number, number][] = [];
    for (const rating of [0, 20, 60, 150, 300, 460]) for (const waited of [0, 9_999, 10_000, 25_000, 60_000, 600_000]) windows.push([rating, waited]);
    const node = windows.map(([r, w]) => matchWindow(r, w));
    const got = php({ codes: [], windows }).windows;
    got.forEach((w, i) => expect(w).toBeCloseTo(node[i], 9));
  });

  it('pairs up and offers the same players, in the same order', () => {
    const all = scenes();
    const got = php({ codes: [], windows: [], scenes: all });
    const asIndexes = (scene: Scene, pairs: [Waiting, Waiting][]) =>
      pairs.map(([a, b]) => [scene.waiting.indexOf(a as Scene['waiting'][number]), scene.waiting.indexOf(b as Scene['waiting'][number])]);
    const map = (o: Record<string, number>) => new Map(Object.entries(o));
    const pairs = all.map((c) => asIndexes(c, findPairs(c.waiting, c.now, map(c.recent))));
    const offers = all.map((c) => asIndexes(c, findOffers(c.waiting, c.now, map(c.recent), map(c.declined))));
    // The scenes should exercise both: some rooms with pairs or offers, some with none.
    expect(pairs.filter((p) => p.length).length).toBeGreaterThan(10);
    expect(offers.filter((p) => p.length).length).toBeGreaterThan(10);
    expect(offers.filter((p) => !p.length).length).toBeGreaterThan(3);
    expect(got.pairs).toEqual(pairs);
    expect(got.offers).toEqual(offers);
  });
});
