import { describe, expect, it } from 'vitest';
import { HOUR } from './clock';
import { formFor, speciesName, topStat } from './evolution';
import { advance, DEFAULT_SETTINGS, hatch, newGame } from './game';
import { feedPet, migratePet } from './pet';
import { canTrain, finishTraining, refusalChance, startTraining, STAT_CAPS, trainGain } from './training';
import type { GameState, PetState } from './types';

const at = (day: number, hour: number, min = 0) => new Date(2026, 0, day, hour, min).getTime();

/** A freshly hatched pet at 09:00 on day 1, in Cozy mode so neglect never ends the run. */
function hatched(seed = 7): GameState & { pet: PetState } {
  const s = newGame(at(1, 9) - 30 * HOUR, { ...DEFAULT_SETTINGS, neglect: 'cozy' }, seed);
  s.simTime = at(1, 9);
  hatch(s, at(1, 9), false);
  return s as GameState & { pet: PetState };
}

/** A rested, fed, well-behaved child at 10:00 on day 2. */
function child(): GameState & { pet: PetState } {
  const s = hatched();
  advance(s, at(2, 10));
  Object.assign(s.pet, { energy: 100, hunger: 80, discipline: 100, sick: false, napping: false });
  return s;
}

describe('training', () => {
  it('is only possible for an awake, healthy, rested child or older', () => {
    const s = hatched();
    expect(canTrain(s.pet, at(1, 10), s.settings)).toBe('baby');
    advance(s, at(2, 10));
    Object.assign(s.pet, { energy: 100, hunger: 80 });
    expect(canTrain(s.pet, at(2, 10), s.settings)).toBe('ok');
    expect(canTrain(s.pet, at(2, 23), s.settings)).toBe('asleep');
    s.pet.energy = 10;
    expect(canTrain(s.pet, at(2, 10), s.settings)).toBe('tired');
    s.pet.energy = 100;
    s.pet.hunger = 5;
    expect(canTrain(s.pet, at(2, 10), s.settings)).toBe('hungry');
    s.pet.hunger = 80;
    s.pet.sick = true;
    expect(canTrain(s.pet, at(2, 10), s.settings)).toBe('sick');
  });

  it('turns a better score into a bigger gain and costs energy', () => {
    const s = child();
    expect(trainGain(s.pet, 'wits', 0)).toBe(1);
    expect(trainGain(s.pet, 'wits', 1)).toBeGreaterThan(trainGain(s.pet, 'wits', 0.5));
    const energy = s.pet.energy;
    const r = finishTraining(s.pet, 'wits', 1);
    expect(r.gain).toBe(trainGain(s.pet, 'wits', 1));
    expect(s.pet.stats.wits).toBe(r.gain);
    expect(s.pet.energy).toBe(energy - 20);
    expect(s.pet.trainings).toBe(1);
  });

  it('learns more slowly the higher a stat already is', () => {
    const s = child();
    const fresh = trainGain(s.pet, 'speed', 0.8);
    s.pet.stats.speed = 60;
    const trained = trainGain(s.pet, 'speed', 0.8);
    s.pet.stats.speed = 99;
    expect(trained).toBeLessThan(fresh);
    expect(trainGain(s.pet, 'speed', 0.8)).toBeLessThan(trained);
    expect(trainGain(s.pet, 'speed', 0)).toBe(1);
  });

  it('learns its type’s favorite stat faster', () => {
    const s = child();
    s.pet.type = 'ember';
    expect(trainGain(s.pet, 'power', 1)).toBeGreaterThan(trainGain(s.pet, 'guard', 1));
  });

  it('caps every stat by life stage', () => {
    const s = child();
    for (let i = 0; i < 20; i++) {
      s.pet.energy = 100;
      finishTraining(s.pet, 'power', 1);
    }
    expect(s.pet.stats.power).toBe(STAT_CAPS[1]);
    expect(finishTraining(s.pet, 'power', 1)).toEqual({ gain: 0, capped: true });
  });

  it('lets an undisciplined pet refuse, as a tantrum to scold', () => {
    const s = child();
    expect(refusalChance(s.pet)).toBe(0);
    s.pet.discipline = 0;
    expect(refusalChance(s.pet)).toBeCloseTo(0.3);
    let refused = 0;
    for (let i = 0; i < 200; i++) {
      s.pet.call = null;
      s.pet.trainings = i;
      if (startTraining(s.pet, at(2, 10) + i * 60_000) === 'refused') {
        refused++;
        expect(s.pet.call).toMatchObject({ kind: 'fake' });
      }
    }
    expect(refused).toBeGreaterThan(30);
    expect(refused).toBeLessThan(90);
  });
});

describe('evolution', () => {
  it('becomes a bright child after attentive baby care, a scruffy one after neglect', () => {
    const good = hatched();
    // A diligent owner: checks in every 30 minutes, lights off at night.
    for (let i = 1; i <= 50; i++) {
      const t = at(1, 9) + i * 0.5 * HOUR;
      advance(good, t);
      const h = new Date(t).getHours();
      good.egg.lightsOn = h >= 7 && h < 22;
      if (!good.egg.lightsOn) continue;
      if (good.pet.hunger < 60) feedPet(good.pet, t, good.settings);
      good.pet.mood = 100;
      good.pet.droppings = [];
      if (good.pet.call?.kind === 'fake') good.pet.call = null;
    }
    expect(good.pet.stage).toBe(1);
    expect(good.pet.form).toBe('child.bright');

    const bad = hatched();
    advance(bad, at(2, 10));
    expect(bad.pet.mistakes[0]).toBeGreaterThan(2);
    expect(bad.pet.form).toBe('child.scruffy');
  });

  it('picks the teen form by physical vs. technical training and the adult form by best stat', () => {
    const s = child();
    s.pet.stats = { power: 5, speed: 5, guard: 12, wits: 0 };
    expect(formFor(s.pet, 2)).toBe('teen.technical');
    s.pet.stats = { power: 10, speed: 5, guard: 12, wits: 0 };
    expect(formFor(s.pet, 2)).toBe('teen.physical');
    s.pet.stats = { power: 10, speed: 40, guard: 12, wits: 39 };
    expect(formFor(s.pet, 3)).toBe('adult.speed');
  });

  it('breaks stat ties in favor of the type’s favorite', () => {
    const s = child();
    s.pet.type = 'bloom';
    s.pet.stats = { power: 20, speed: 0, guard: 20, wits: 0 };
    expect(topStat(s.pet)).toBe('guard');
    s.pet.type = 'tide';
    expect(topStat(s.pet)).toBe('power');
  });

  it('evolves during catch-up and keeps the adult form as an elder', () => {
    const s = hatched();
    s.pet.stats = { power: 0, speed: 0, guard: 0, wits: 3 };
    advance(s, at(11, 12));
    expect(s.pet.stage).toBe(3);
    expect(s.pet.form).toBe('adult.wits');
    expect(s.pet.shownStage).toBe(0);
    advance(s, at(33, 12));
    expect(s.pet.stage).toBe(4);
    expect(s.pet.form).toBe('adult.wits');
    expect(speciesName(s.pet.type, s.pet.form)).toBeTruthy();
  });

  it('gives older saves stats and a form', () => {
    const s = hatched();
    const old = { ...s.pet } as Partial<PetState> & Pick<PetState, 'type' | 'seed' | 'hatchedAt'>;
    for (const k of ['stage', 'form', 'shownStage', 'shownForm', 'stats', 'trainings'] as const) delete old[k];
    const pet = migratePet(old);
    expect(pet.stats).toEqual({ power: 0, speed: 0, guard: 0, wits: 0 });
    expect(pet.form).toBe('baby');
  });
});
