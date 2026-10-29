import { describe, expect, it } from 'vitest';
import { HOUR } from './clock';
import { advance, DEFAULT_SETTINGS, hatch, heritageOf, layNewEgg, newGame } from './game';
import { importSave, exportSave } from './save';
import type { GameState, PetState } from './types';

const T0 = new Date(2026, 0, 1, 9).getTime();

function withPet(): GameState & { pet: PetState } {
  const s = newGame(T0, { ...DEFAULT_SETTINGS, neglect: 'cozy' }, 11);
  hatch(s, T0, false);
  Object.assign(s.pet!, { name: 'Pip', stats: { power: 30, speed: 70, guard: 10, wits: 5 }, form: 'adult.speed' });
  s.pet!.battles.wins = 4;
  return s as GameState & { pet: PetState };
}

describe('inheritance', () => {
  it('passes a head start in the best stat from a retired pet to its egg', () => {
    const s = withPet();
    s.pet.status = 'retired';
    layNewEgg(s, T0 + 900 * HOUR, 12);
    expect(s.egg.heritage).toEqual({ parentName: 'Pip', parentType: s.family[0].type, stat: 'speed', bonus: 7, generation: 2 });
    const child = hatch(s, T0 + 930 * HOUR, false);
    expect(child.stats.speed).toBe(7);
    expect(child.stats.power).toBe(0);
    expect(child.generation).toBe(2);
  });

  it('gives at least 3 and at most 8 points', () => {
    const s = withPet();
    s.pet.stats = { power: 0, speed: 0, guard: 0, wits: 0 };
    expect(heritageOf(s.pet).bonus).toBe(3);
    s.pet.stats.wits = 100;
    expect(heritageOf(s.pet).bonus).toBe(8);
  });

  it('passes nothing on after running away, dying or a manual restart', () => {
    for (const status of ['ranAway', 'died', 'alive'] as const) {
      const s = withPet();
      s.pet.status = status;
      layNewEgg(s, T0 + 50 * HOUR, 12);
      expect(s.egg.heritage).toBeNull();
      expect(s.family[0].ending).toBe(status === 'alive' ? 'released' : status);
    }
  });

  it('keeps every past pet in the family list, across generations and saves', () => {
    const s = withPet();
    s.pet.status = 'retired';
    layNewEgg(s, T0 + 900 * HOUR, 12);
    s.egg.devHours = s.egg.baseHours;
    advance(s, T0 + 950 * HOUR);
    expect(s.phase).toBe('hatched');
    s.pet!.status = 'retired';
    layNewEgg(s, T0 + 1900 * HOUR, 13);
    expect(s.family.map((a) => [a.name, a.generation, a.ending])).toEqual([
      ['Pip', 1, 'retired'],
      [s.family[1].name, 2, 'retired'],
    ]);
    expect(s.family[0].wins).toBe(4);
    expect(s.egg.heritage?.generation).toBe(3);
    expect(importSave(exportSave(s)).family).toHaveLength(2);
  });

  it('reads older saves without a family or heritage', () => {
    const s = withPet() as Partial<GameState>;
    delete s.family;
    delete (s.egg as Partial<GameState['egg']>).heritage;
    const loaded = importSave(exportSave(s as GameState));
    expect(loaded.family).toEqual([]);
    expect(loaded.egg.heritage).toBeNull();
  });
});
