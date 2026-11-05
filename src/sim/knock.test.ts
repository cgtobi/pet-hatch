import { describe, expect, it } from 'vitest';
import { knockPattern, matchesKnock } from './knock';
import { mulberry32 } from './rng';

describe('knock back', () => {
  it('knocks 2 to 4 times with short and long gaps', () => {
    const rand = mulberry32(5);
    const counts = new Set<number>();
    for (let i = 0; i < 100; i++) {
      const p = knockPattern(rand);
      counts.add(p.length);
      expect(p[0]).toBe(0);
      for (let j = 1; j < p.length; j++) expect([0.3, 0.6]).toContainEqual(Number((p[j] - p[j - 1]).toFixed(2)));
    }
    expect([...counts].sort()).toEqual([2, 3, 4]);
  });

  it('accepts the same rhythm, a little off', () => {
    expect(matchesKnock([0, 0.3, 0.9], [5, 5.38, 5.9])).toBe(true);
    expect(matchesKnock([0, 0.6], [1, 1.35])).toBe(true);
  });

  it('refuses a different count or rhythm', () => {
    expect(matchesKnock([0, 0.3, 0.9], [0, 0.3])).toBe(false);
    expect(matchesKnock([0, 0.3, 0.9], [0, 0.3, 0.6, 0.9])).toBe(false);
    // Short-long answered as long-short.
    expect(matchesKnock([0, 0.3, 0.9], [0, 0.6, 0.9])).toBe(false);
  });
});
