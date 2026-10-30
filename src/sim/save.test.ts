import { describe, expect, it } from 'vitest';
import { resolveLang } from '../i18n';
import { HOUR } from './clock';
import { DEFAULT_SETTINGS, hatch, newGame } from './game';
import { exportSave, importSave } from './save';
import type { GameState } from './types';

const T0 = new Date(2026, 0, 1, 9).getTime();

function game(): GameState {
  const s = newGame(T0, DEFAULT_SETTINGS, 11);
  hatch(s, T0 + 30 * HOUR, false);
  return s;
}

/** A save code with something changed in it, as anyone could make one. */
function tampered(change: (s: GameState & Record<string, unknown>) => void): string {
  const s = JSON.parse(JSON.stringify(game()));
  change(s);
  return exportSave(s);
}

describe('importing a save code', () => {
  it('takes back what the game wrote, egg or pet', () => {
    expect(importSave(exportSave(newGame(T0, DEFAULT_SETTINGS, 3))).phase).toBe('egg');
    const s = game();
    s.pet!.name = 'Mochi ✨';
    s.pet!.stats.power = 30;
    expect(importSave(exportSave(s)).pet?.name).toBe('Mochi ✨');
  });

  it('refuses anything that could end up as markup or break the game', () => {
    const bad: ((s: GameState) => void)[] = [
      (s) => ((s.pet!.stats as Record<string, unknown>).power = '<img src=x onerror=alert(1)>'),
      (s) => ((s.pet!.battles as Record<string, unknown>).wins = '<b>1</b>'),
      (s) => ((s.pet as unknown as Record<string, unknown>).endurance = '9'),
      (s) => ((s.settings as unknown as Record<string, unknown>).language = 'xx'),
      (s) => ((s.settings as unknown as Record<string, unknown>).language = '__proto__'),
      (s) => (s.pet!.name = 'x'.repeat(500)),
      (s) => ((s.pet as unknown as Record<string, unknown>).form = 'adult.dragon'),
      (s) => (s.pet!.path = ['baby', 'evil' as never]),
      (s) => s.family.push({ name: 'A', type: 'ember', form: 'baby', generation: 1, ending: 'retired', wins: 0, stars: 1e9, hatchedAt: 0, endedAt: 0 }),
      (s) => ((s.pet!.stats as Record<string, unknown>).magic = 5),
      (s) => (s.pet!.energy = Number.POSITIVE_INFINITY),
    ];
    for (const change of bad) expect(() => importSave(tampered(change))).toThrow();
  });

  it('falls back to the device language for a language it doesn’t know', () => {
    expect(resolveLang('xx' as never)).toBe('en');
    expect(resolveLang('constructor' as never)).toBe('en');
    expect(resolveLang('de')).toBe('de');
  });
});
