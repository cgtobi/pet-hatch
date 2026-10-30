// @vitest-environment node
/**
 * The PHP dojo rules (server/php/dojo.php) against the Node ones (server/dojo.mjs, themselves checked against the
 * game's battleRating() in src/net/dojo.test.ts), on the same battle codes and waits. Run by `npm run test:php`,
 * which sets PHP_CHECK_DOJO to the command that runs server/php/check-dojo.php; skipped otherwise.
 */
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { matchWindow, ratingFromCode } from '../dojo.mjs';
import type { Fighter } from '../../src/sim/battle';
import { encodeFighter } from '../../src/sim/battlecode';
import { mulberry32 } from '../../src/sim/rng';
import { STAT_CAPS } from '../../src/sim/training';

const command = process.env.PHP_CHECK_DOJO ? (JSON.parse(process.env.PHP_CHECK_DOJO) as string[]) : null;

function php(input: { codes: string[]; windows: [number, number][] }): { ratings: (number | null)[]; windows: number[] } {
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
});
