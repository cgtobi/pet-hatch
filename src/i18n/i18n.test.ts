import { describe, expect, it } from 'vitest';
import { de } from './de';
import { en } from './en';
import { es } from './es';
import { fr } from './fr';
import { it as italian } from './it';
import { nl } from './nl';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const keys = Object.keys(en) as (keyof typeof en)[];

describe.each([
  ['de', de],
  ['fr', fr],
  ['es', es],
  ['it', italian],
  ['nl', nl],
] as const)('%s translation', (_, dict) => {
  it('has exactly the English keys', () => {
    expect(Object.keys(dict).sort()).toEqual([...keys].sort());
  });

  it('keeps every placeholder and help line', () => {
    for (const key of keys) {
      expect(placeholders(dict[key]), key).toEqual(placeholders(en[key]));
      expect(dict[key].split('\n').length, key).toBe(en[key].split('\n').length);
    }
  });

  it('has no untranslated leftovers in longer texts', () => {
    // Short labels (names, "Max", "Training") may match English; sentences should not.
    const same = keys.filter((k) => dict[k] === en[k] && en[k].length > 24);
    expect(same).toEqual([]);
  });

  it('keeps dock labels short enough for a six-button bar', () => {
    for (const key of keys.filter((k) => k.startsWith('action.'))) expect(dict[key].length, key).toBeLessThanOrEqual(9);
  });
});
