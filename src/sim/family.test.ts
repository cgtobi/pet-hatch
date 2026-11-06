import { describe, expect, it } from 'vitest';
import { HOUR } from './clock';
import { advance, DEFAULT_SETTINGS, elderLeaves, handOver, hatch, heritageOf, isReadyToHatch, layNewEgg, MASTERED_BONUS, newGame } from './game';
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
    expect(s.egg.heritage).toEqual({ parentName: 'Pip', parentType: s.family[0].type, stats: { speed: 7 }, generation: 2 });
    const child = hatch(s, T0 + 930 * HOUR, false);
    expect(child.stats.speed).toBe(7);
    expect(child.stats.power).toBe(0);
    expect(child.generation).toBe(2);
  });

  it('gives at least 3 and at most 8 points', () => {
    const s = withPet();
    s.pet.stats = { power: 0, speed: 0, guard: 0, wits: 0 };
    expect(Object.values(heritageOf(s.pet).stats)).toEqual([3]);
    s.pet.stats.wits = 100;
    expect(heritageOf(s.pet).stats).toEqual({ wits: 8 });
  });

  it('passes more on for every other stat at 100, and remembers them as stars', () => {
    const s = withPet();
    s.pet.type = 'tide'; // ties go to the favorite stat, Speed
    s.pet.stats = { power: 100, speed: 100, guard: 100, wits: 64 };
    expect(heritageOf(s.pet).stats).toEqual({ speed: 8, power: MASTERED_BONUS, guard: MASTERED_BONUS });
    s.pet.status = 'retired';
    layNewEgg(s, T0 + 900 * HOUR, 12);
    expect(s.family[0].stars).toBe(3);
    const child = hatch(s, T0 + 930 * HOUR, false);
    expect(child.stats).toEqual({ power: MASTERED_BONUS, speed: 8, guard: MASTERED_BONUS, wits: 0 });
  });

  it('takes the neglect mode chosen for the new egg, or keeps the old one', () => {
    const s = withPet();
    layNewEgg(s, T0 + 50 * HOUR, 12, 'classic');
    expect(s.settings.neglect).toBe('classic');
    layNewEgg(s, T0 + 60 * HOUR, 13);
    expect(s.settings.neglect).toBe('classic');
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

  it('reads an older egg that inherited a single stat', () => {
    const s = withPet();
    s.pet.status = 'retired';
    layNewEgg(s, T0 + 900 * HOUR, 12);
    s.egg.heritage = { ...s.egg.heritage!, stats: undefined!, stat: 'guard', bonus: 6 } as GameState['egg']['heritage'];
    const loaded = importSave(exportSave(s));
    expect(loaded.egg.heritage).toEqual({ parentName: 'Pip', parentType: s.family[0].type, stats: { guard: 6 }, generation: 2 });
  });
});

describe('handing over to the egg', () => {
  it('wakes the egg when the elder retires: it inherits, and the elder waits with its needs paused', () => {
    const s = withPet();
    s.pet.stage = s.pet.shownStage = 4;
    s.pet.status = 'retired';
    const elder = s.pet;
    advance(s, s.simTime + 60_000);
    expect(s.phase).toBe('egg');
    expect(s.pet).toBeNull();
    expect(s.elder).toMatchObject({ pet: elder, told: false });
    expect(s.island).toBe(11);
    expect(s.egg.heritage).toMatchObject({ parentName: 'Pip', stats: { speed: 7 }, generation: 2 });
    expect(s.family).toHaveLength(0);
    const mood = elder.mood;
    advance(s, s.simTime + 3 * HOUR);
    expect(elder.mood).toBe(mood);
  });

  it('gives the same egg however the time is caught up', () => {
    const a = withPet();
    const b = withPet();
    for (const s of [a, b]) {
      s.pet.status = 'retired';
      advance(s, s.simTime + 60_000);
    }
    expect(a.egg.seed).toBe(b.egg.seed);
    expect(a.egg.seed).not.toBe(11);
  });

  it('lets the elder join the family once its egg has hatched and it said goodbye', () => {
    const s = withPet();
    s.pet.status = 'retired';
    handOver(s, T0 + 900 * HOUR);
    s.egg.readyAt = T0 + 905 * HOUR;
    expect(isReadyToHatch(s)).toBe(true);
    const baby = hatch(s, T0 + 906 * HOUR, false);
    expect(baby.generation).toBe(2);
    expect(s.elder?.pet.name).toBe('Pip');
    elderLeaves(s, T0 + 906 * HOUR);
    expect(s.elder).toBeUndefined();
    expect(s.family.map((a) => [a.name, a.ending])).toEqual([['Pip', 'retired']]);
  });

  it('still lets the elder go when a new egg is started instead', () => {
    const s = withPet();
    s.pet.status = 'retired';
    handOver(s, T0 + 900 * HOUR);
    layNewEgg(s, T0 + 901 * HOUR, 12);
    expect(s.elder).toBeUndefined();
    expect(s.island).toBeUndefined();
    expect(s.family.map((a) => a.name)).toEqual(['Pip']);
  });

  it('keeps a waiting elder in the save', () => {
    const s = withPet();
    s.pet.status = 'retired';
    handOver(s, T0 + 900 * HOUR);
    const back = importSave(exportSave(s));
    expect(back.elder?.pet.name).toBe('Pip');
    expect(back.phase).toBe('egg');
  });
});
