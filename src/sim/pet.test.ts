import { describe, expect, it } from 'vitest';
import { HOUR } from './clock';
import { advance, DEFAULT_SETTINGS, hatch, newGame } from './game';
import {
  cleanUp,
  feedPet,
  giveMedicine,
  lifeStage,
  lowestNeed,
  migratePet,
  playWith,
  scold,
} from './pet';
import type { GameState, NeglectMode, PetState } from './types';

const at = (day: number, hour: number, min = 0) => new Date(2026, 0, day, hour, min).getTime();

/** A freshly hatched pet at 09:00 on day 1. */
function hatched(neglect: NeglectMode = 'gentle', seed = 7): GameState & { pet: PetState } {
  const s = newGame(at(1, 9) - 30 * HOUR, { ...DEFAULT_SETTINGS, neglect }, seed);
  s.simTime = at(1, 9);
  hatch(s, at(1, 9), false);
  return s as GameState & { pet: PetState };
}

/** A diligent owner checking in every 30 minutes while awake. */
function careFor(s: GameState & { pet: PetState }, hours: number) {
  const start = s.simTime;
  for (let i = 1; i <= hours * 2 && s.pet.status === 'alive'; i++) {
    const t = start + i * 0.5 * HOUR;
    advance(s, t);
    const h = new Date(t).getHours();
    if (h < 7 || h >= 22) {
      s.egg.lightsOn = false;
      continue;
    }
    s.egg.lightsOn = true;
    if (s.pet.hunger < 60) feedPet(s.pet, t, s.settings);
    if (s.pet.mood < 60) playWith(s.pet, t, s.settings);
    cleanUp(s.pet);
    if (s.pet.sick) giveMedicine(s.pet);
    if (s.pet.call?.kind === 'fake') scold(s.pet);
  }
}

describe('aging', () => {
  it('grows through the life stages and finally retires', () => {
    const s = hatched();
    expect(lifeStage(s.pet, at(1, 10))).toBe('baby');
    expect(lifeStage(s.pet, at(2, 10))).toBe('child');
    expect(lifeStage(s.pet, at(5, 10))).toBe('teen');
    expect(lifeStage(s.pet, at(10, 10))).toBe('adult');
    expect(lifeStage(s.pet, at(31, 10))).toBe('elder');
    s.settings.neglect = 'cozy';
    advance(s, at(38, 10));
    expect(s.pet.status).toBe('retired');
  });
});

describe('daily care', () => {
  it('keeps a well cared-for pet healthy with few mistakes', () => {
    const s = hatched('classic');
    careFor(s, 72);
    expect(s.pet.status).toBe('alive');
    expect(s.pet.health).toBeGreaterThan(60);
    expect(s.pet.careMistakes).toBeLessThan(4);
  });

  it('refuses food when full or asleep', () => {
    const s = hatched();
    s.pet.hunger = 95;
    expect(feedPet(s.pet, at(1, 9), s.settings)).toBe('full');
    s.pet.hunger = 10;
    expect(feedPet(s.pet, at(1, 23), s.settings)).toBe('asleep');
    expect(feedPet(s.pet, at(1, 9), s.settings)).toBe('ok');
  });

  it('produces droppings a while after meals', () => {
    const s = hatched();
    s.pet.hunger = 10;
    feedPet(s.pet, at(1, 9), s.settings);
    advance(s, at(1, 9, 50));
    expect(s.pet.droppings.length).toBe(0);
    advance(s, at(1, 12, 30));
    expect(s.pet.droppings.length).toBe(1);
    expect(cleanUp(s.pet)).toBe(1);
  });

  it('restores energy overnight with the lights off', () => {
    const s = hatched();
    s.pet.energy = 10;
    s.egg.lightsOn = false;
    advance(s, at(1, 22));
    advance(s, at(2, 7));
    expect(s.pet.energy).toBeGreaterThan(95);
  });

  it('counts leaving the lights on at night as one mistake per night', () => {
    const s = hatched('cozy');
    s.egg.lightsOn = true;
    advance(s, at(1, 21, 55));
    const before = s.pet.careMistakes;
    advance(s, at(2, 6));
    expect(s.pet.careMistakes - before).toBe(1);
  });
});

describe('attention calls and discipline', () => {
  it('calls when a need runs low, and the call clears once cared for', () => {
    const s = hatched();
    s.pet.hunger = 21;
    advance(s, at(1, 9, 10));
    expect(lowestNeed(s.pet)).toBe('hunger');
    expect(s.pet.call?.kind).toBe('need');
    feedPet(s.pet, at(1, 9, 10), s.settings);
    advance(s, at(1, 9, 11));
    expect(s.pet.call).toBeNull();
  });

  it('throws tantrums that scolding fixes', () => {
    const s = hatched();
    s.pet.nextFakeCallAt = at(1, 9, 5);
    advance(s, at(1, 9, 6));
    expect(s.pet.call?.kind).toBe('fake');
    expect(scold(s.pet)).toBe('disciplined');
    expect(s.pet.discipline).toBe(20);
  });

  it('gets upset when scolded for a real need', () => {
    const s = hatched();
    s.pet.hunger = 5;
    advance(s, at(1, 9, 1));
    const mood = s.pet.mood;
    expect(scold(s.pet)).toBe('unfair');
    expect(s.pet.mood).toBeLessThan(mood);
  });

  it('counts an ignored call as a care mistake', () => {
    const s = hatched('cozy');
    s.pet.hunger = 10;
    advance(s, at(1, 9, 45));
    expect(s.pet.careMistakes).toBeGreaterThanOrEqual(1);
    expect(s.pet.mistakes[0]).toBeGreaterThanOrEqual(1);
  });
});

describe('sickness and neglect modes', () => {
  function neglect(mode: NeglectMode, hours: number) {
    const s = hatched(mode);
    for (let i = 0; i < 4; i++) {
      s.pet.hunger = 50;
      feedPet(s.pet, at(1, 9), s.settings);
    }
    advance(s, at(1, 9) + hours * HOUR);
    return s.pet;
  }

  it('Classic: a neglected pet gets sick and can die', () => {
    expect(neglect('classic', 72).status).toBe('died');
  });

  it('Gentle: a neglected pet never dies but eventually runs away', () => {
    const pet = neglect('gentle', 96);
    expect(pet.status).toBe('ranAway');
  });

  it('Cozy: never sick, never gone', () => {
    const pet = neglect('cozy', 96);
    expect(pet.status).toBe('alive');
    expect(pet.sick).toBe(false);
  });

  it('two doses of medicine cure a sickness', () => {
    const s = hatched();
    s.pet.sick = true;
    s.pet.sickDoses = 2;
    expect(giveMedicine(s.pet)).toBe('dose');
    expect(giveMedicine(s.pet)).toBe('cured');
    expect(giveMedicine(s.pet)).toBe('notSick');
  });
});

describe('catch-up and saves', () => {
  it('gives the same result in one jump as in many small steps', () => {
    const a = hatched();
    const b = hatched();
    for (const s of [a, b]) {
      s.pet.hunger = 50;
      feedPet(s.pet, at(1, 9), s.settings);
    }
    advance(a, at(2, 15));
    for (let t = at(1, 9); t <= at(2, 15); t += 7 * 60_000) advance(b, t);
    advance(b, at(2, 15));
    expect(a.pet.hunger).toBeCloseTo(b.pet.hunger, 6);
    expect(a.pet.droppings.length).toBe(b.pet.droppings.length);
    expect(a.pet.sick).toBe(b.pet.sick);
    expect(a.pet.careMistakes).toBe(b.pet.careMistakes);
  });

  it('upgrades a milestone-1 pet save', () => {
    const pet = migratePet({ type: 'bloom', seed: 3, hatchedAt: 0, health: 90, careMistakes: 2 } as PetState);
    expect(pet.status).toBe('alive');
    expect(pet.hunger).toBeGreaterThan(0);
    expect(pet.careMistakes).toBe(2);
    expect(pet.name).toBeTruthy();
  });
});
