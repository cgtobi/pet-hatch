import { describe, expect, it } from 'vitest';
import { dayPart, HOUR } from './clock';
import { advance, DEFAULT_SETTINGS, hatch, newGame } from './game';
import {
  cleanUp,
  endPowerNap,
  feedPet,
  giveMedicine,
  isSleeping,
  LIFE_STAGES,
  lifeStage,
  lightSwitched,
  lowestNeed,
  migratePet,
  playWith,
  scold,
  stageHours,
  startPowerNap,
  wakeAtNight,
} from './pet';
import { canTrain, refusalChance } from './training';
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
    // This pet's own adult and elder lengths decide when it becomes an elder and when it retires.
    const elderAt = s.pet.hatchedAt + (24 + 72 + 120 + stageHours(s.pet, 'adult')) * HOUR;
    const lifeEnd = elderAt + stageHours(s.pet, 'elder') * HOUR;
    expect(lifeStage(s.pet, elderAt - HOUR)).toBe('adult');
    expect(lifeStage(s.pet, elderAt + HOUR)).toBe('elder');
    s.settings.neglect = 'cozy';
    advance(s, lifeEnd - HOUR);
    expect(s.pet.status).toBe('alive');
    advance(s, lifeEnd + HOUR);
    expect(s.pet.status).toBe('retired');
  });

  it('lives 37 to 42 days: up to 3 more as an adult and 2 more as an elder, fixed per pet', () => {
    const lives = [];
    for (let seed = 1; seed <= 200; seed++) {
      const pet = { seed };
      expect(stageHours(pet, 'adult')).toBeGreaterThanOrEqual(21 * 24);
      expect(stageHours(pet, 'adult')).toBeLessThanOrEqual(24 * 24);
      expect(stageHours(pet, 'elder')).toBeGreaterThanOrEqual(7 * 24);
      expect(stageHours(pet, 'elder')).toBeLessThanOrEqual(9 * 24);
      expect(stageHours(pet, 'adult')).toBe(stageHours({ seed }, 'adult'));
      lives.push(LIFE_STAGES.reduce((h, stage) => h + stageHours(pet, stage), 0) / 24);
    }
    expect(Math.min(...lives)).toBeLessThan(38);
    expect(Math.max(...lives)).toBeGreaterThan(41);
  });

  it('never grows backwards when an older pet gets its extra adult days', () => {
    const s = hatched();
    s.pet.stage = 4;
    expect(lifeStage(s.pet, s.pet.hatchedAt + 30 * 24 * HOUR)).toBe('elder');
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

  it('lets a pet sleep with the light on, just less well, and without a care mistake', () => {
    const lit = hatched('cozy');
    const dark = hatched('cozy');
    for (const s of [lit, dark]) {
      advance(s, at(1, 21, 55));
      Object.assign(s.pet, { energy: 20, hunger: 100, mood: 50 });
      s.egg.lightsOn = s === lit;
    }
    const before = lit.pet.careMistakes;
    advance(lit, at(2, 6));
    advance(dark, at(2, 6));
    expect(lit.pet.careMistakes).toBe(before);
    expect(lit.pet.energy).toBeLessThan(dark.pet.energy);
    expect(lit.pet.hunger).toBeLessThan(dark.pet.hunger);
  });

  it('wakes happy after a night in the dark, and not after one with the light on', () => {
    const dark = hatched('cozy');
    const lit = hatched('cozy');
    for (const s of [dark, lit]) {
      advance(s, at(1, 21, 55));
      Object.assign(s.pet, { hunger: 100, mood: 50 });
      s.egg.lightsOn = s === lit;
      advance(s, at(2, 7, 1));
    }
    expect(dark.pet.wake).toBe('morning');
    expect(lit.pet.wake).toBeNull();
    expect(dark.pet.mood).toBeGreaterThan(lit.pet.mood);
    // Morning switches the light back on for the day.
    expect(dark.egg.lightsOn).toBe(true);
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

describe('power naps', () => {
  /** A tired, fed pet at 10:00 with the lights off, as when the player just switched them off. */
  function tired(energy = 30) {
    const s = hatched('gentle');
    advance(s, at(1, 10));
    Object.assign(s.pet, { energy, hunger: 100, mood: 80, call: null, droppings: [], poopsDue: [] });
    s.egg.lightsOn = false;
    return s;
  }

  it('only lets a tired pet nap; a wide-awake one stays up', () => {
    const awake = tired(40);
    expect(startPowerNap(awake.pet, at(1, 10), awake.settings)).toBe('notSleepy');
    expect(awake.pet.mood).toBe(80);
    expect(awake.pet.napping).toBe(false);
    const sleepy = tired(39);
    expect(startPowerNap(sleepy.pet, at(1, 10), sleepy.settings)).toBe('ok');
    expect(sleepy.pet.napping).toBe(true);
    expect(isSleeping(sleepy.pet, at(1, 10), sleepy.settings)).toBe(true);
  });

  it('won’t start when the pet is hungry or sick, or at bedtime', () => {
    const hungry = tired();
    hungry.pet.hunger = 10;
    expect(startPowerNap(hungry.pet, at(1, 10), hungry.settings)).toBe('needsCare');
    const sick = tired();
    sick.pet.sick = true;
    expect(startPowerNap(sick.pet, at(1, 10), sick.settings)).toBe('needsCare');
    const late = tired();
    expect(startPowerNap(late.pet, at(1, 23), late.settings)).toBe('night');
    const evening = tired();
    expect(startPowerNap(evening.pet, at(1, 19), evening.settings)).toBe('night');
  });

  it('rests the pet for an hour with needs at half speed, then wakes it rested', () => {
    const s = tired(30);
    startPowerNap(s.pet, at(1, 10), s.settings);
    advance(s, at(1, 10, 59));
    expect(s.pet.napping).toBe(true);
    advance(s, at(1, 11));
    expect(s.pet.energy).toBeCloseTo(55, 0);
    // Babies lose 25 food per awake hour; napping halves that.
    expect(s.pet.hunger).toBeCloseTo(87.5, 0);
    expect(s.pet.powerNap).toBeNull();
    expect(s.pet.napping).toBe(false);
    expect(s.pet.wake).toBe('rested');
  });

  it('ends a power nap sooner once the pet is at 90%', () => {
    const s = tired(39);
    s.pet.endurance = 100;
    s.pet.energy = 39;
    startPowerNap(s.pet, at(1, 10), s.settings);
    s.pet.energy = 80;
    advance(s, at(1, 10, 30));
    expect(s.pet.powerNap).toBeNull();
    expect(s.pet.wake).toBe('rested');
  });

  it('wakes early when hunger gets low, and then calls for food', () => {
    const s = tired(10);
    s.pet.hunger = 30;
    startPowerNap(s.pet, at(1, 10), s.settings);
    advance(s, at(1, 12));
    expect(s.pet.wake).toBe('need');
    expect(s.pet.call).toMatchObject({ kind: 'need' });
  });

  it('is grumpy when woken too soon, fine later', () => {
    const early = tired();
    startPowerNap(early.pet, at(1, 10), early.settings);
    expect(endPowerNap(early.pet, at(1, 10, 10))).toBe('grumpy');
    expect(early.pet.mood).toBe(75);
    const later = tired();
    startPowerNap(later.pet, at(1, 10), later.settings);
    expect(endPowerNap(later.pet, at(1, 10, 45))).toBe('woke');
    expect(later.pet.mood).toBe(80);
    expect(endPowerNap(later.pet, at(1, 11))).toBe('none');
  });

  it('runs into the evening, where the rested pet dozes on in the dark', () => {
    const s = tired(10);
    advance(s, at(1, 17));
    Object.assign(s.pet, { energy: 10, hunger: 100, napping: false, droppings: [], poopsDue: [] });
    startPowerNap(s.pet, at(1, 17), s.settings);
    advance(s, at(1, 21));
    expect(s.pet.powerNap).toBeNull();
    expect(s.pet.wake).toBe('rested');
    expect(s.pet.dozing).toBe(true);
  });

  it('naps an exhausted pet on its own, until it has 40% again', () => {
    const s = tired(4);
    s.egg.lightsOn = true;
    advance(s, at(1, 10, 5));
    expect(s.pet.napping).toBe(true);
    expect(s.pet.powerNap).toBeNull();
    // 36 points at 25 per hour: about an hour and a half.
    advance(s, at(1, 11, 20));
    expect(s.pet.napping).toBe(true);
    advance(s, at(1, 11, 40));
    expect(s.pet.napping).toBe(false);
    expect(s.pet.energy).toBeGreaterThanOrEqual(39);
  });

  it('gives older pets no nap state', () => {
    const s = hatched();
    const old = { ...s.pet } as Partial<PetState> & Pick<PetState, 'type' | 'seed' | 'hatchedAt'>;
    delete old.powerNap;
    delete old.wake;
    delete old.shellSwept;
    const pet = migratePet(old);
    expect(pet.powerNap).toBeNull();
    expect(pet.wake).toBeNull();
    expect(pet.shellSwept).toBe(false);
  });
});

describe('evenings', () => {
  /** A fed, content pet at 17:30, half an hour before the evening (bedtime 22:00). */
  function beforeEvening() {
    const s = hatched('gentle');
    advance(s, at(1, 17, 30));
    Object.assign(s.pet, { energy: 80, hunger: 100, mood: 80, sick: false, napping: false, call: null, droppings: [], poopsDue: [] });
    s.pet.nextFakeCallAt = at(2, 12);
    return s;
  }

  it('starts 4 hours before bedtime and ends at bedtime', () => {
    const settings = DEFAULT_SETTINGS;
    expect(dayPart(at(1, 17, 59), settings)).toBe('day');
    expect(dayPart(at(1, 18), settings)).toBe('evening');
    expect(dayPart(at(1, 21, 59), settings)).toBe('evening');
    expect(dayPart(at(1, 22), settings)).toBe('night');
    expect(dayPart(at(2, 7), settings)).toBe('day');
    const late = { ...settings, sleepStart: 1, sleepEnd: 9 };
    expect(dayPart(at(1, 20, 59), late)).toBe('day');
    expect(dayPart(at(1, 23), late)).toBe('evening');
    expect(dayPart(at(2, 0, 30), late)).toBe('evening');
    expect(dayPart(at(1, 20), { ...settings, sleepStart: 0, sleepEnd: 0 })).toBe('day');
  });

  it('gets dark, and the pet dozes off: no food, play or training until the light is on', () => {
    const s = beforeEvening();
    advance(s, at(1, 18, 30));
    expect(s.egg.lightsOn).toBe(false);
    expect(s.pet.dozing).toBe(true);
    expect(isSleeping(s.pet, at(1, 18, 30), s.settings)).toBe(true);
    expect(feedPet(s.pet, at(1, 18, 30), s.settings)).toBe('asleep');
    expect(playWith(s.pet, at(1, 18, 30), s.settings)).toBe('asleep');
    s.pet.stage = 1; // babies can't train at all
    expect(canTrain(s.pet, at(1, 18, 30), s.settings)).toBe('asleep');
  });

  it('wakes gently when the light goes on, and stays up until bedtime', () => {
    const s = beforeEvening();
    advance(s, at(1, 18, 30));
    const mood = s.pet.mood;
    s.egg.lightsOn = true;
    expect(lightSwitched(s.pet, at(1, 18, 30), s.settings, true)).toBe('perked');
    expect(s.pet.mood).toBe(mood);
    advance(s, at(1, 21, 30));
    expect(s.pet.dozing).toBe(false);
    s.pet.hunger = 100;
    expect(playWith(s.pet, at(1, 21, 30), s.settings)).toBe('ok');
    s.egg.lightsOn = false;
    expect(lightSwitched(s.pet, at(1, 21, 30), s.settings, false)).toBe('dozed');
  });

  it('can’t doze while hungry, and calls instead', () => {
    const s = beforeEvening();
    advance(s, at(1, 18, 30));
    s.pet.hunger = 15;
    advance(s, at(1, 18, 35));
    expect(s.pet.dozing).toBe(false);
    expect(s.pet.call).toMatchObject({ kind: 'need' });
    expect(feedPet(s.pet, at(1, 18, 35), s.settings)).toBe('ok');
    s.egg.lightsOn = true;
    expect(lightSwitched(s.pet, at(1, 18, 35), s.settings, true)).toBe('none');
  });

  it('drains needs at half speed while dozing, so it is no shortcut around care', () => {
    const s = beforeEvening();
    advance(s, at(1, 18));
    const hunger = s.pet.hunger;
    advance(s, at(1, 19));
    // Babies lose 25 food per awake hour.
    expect(hunger - s.pet.hunger).toBeCloseTo(12.5, 0);
  });
});

describe('waking at night', () => {
  /** A fed, content child asleep at 23:00 with the light on. */
  function asleep(neglect: NeglectMode = 'gentle') {
    const s = hatched(neglect);
    advance(s, at(1, 21, 55));
    Object.assign(s.pet, { stage: 1, hunger: 100, mood: 80, energy: 60, sick: false, call: null, droppings: [], poopsDue: [] });
    s.egg.lightsOn = true;
    advance(s, at(1, 23));
    return s;
  }

  it('wakes a pet grumpily, for food, play and training', () => {
    const s = asleep();
    const mood = s.pet.mood;
    expect(isSleeping(s.pet, at(1, 23), s.settings)).toBe(true);
    expect(wakeAtNight(s.pet, at(1, 23), s.settings)).toBe('woke');
    expect(s.pet.mood).toBe(mood - 10);
    expect(isSleeping(s.pet, at(1, 23), s.settings)).toBe(false);
    expect(playWith(s.pet, at(1, 23), s.settings)).toBe('ok');
    expect(canTrain(s.pet, at(1, 23), s.settings)).toBe('ok');
    // Grumpy pets obey less.
    expect(refusalChance(s.pet)).toBeGreaterThan(0.25);
    // Already up: nothing more happens.
    expect(wakeAtNight(s.pet, at(1, 23, 5), s.settings)).toBe('none');
  });

  it('falls asleep again after an hour, or as soon as the light goes off', () => {
    const s = asleep();
    wakeAtNight(s.pet, at(1, 23), s.settings);
    advance(s, at(1, 23, 59));
    expect(s.pet.upLate).not.toBeNull();
    advance(s, at(2, 0, 1));
    expect(s.pet.upLate).toBeNull();
    expect(s.pet.wake).toBe('backToSleep');
    expect(isSleeping(s.pet, at(2, 0, 1), s.settings)).toBe(true);
    wakeAtNight(s.pet, at(2, 0, 1), s.settings);
    s.egg.lightsOn = false;
    expect(lightSwitched(s.pet, at(2, 0, 2), s.settings, false)).toBe('slept');
    expect(isSleeping(s.pet, at(2, 0, 2), s.settings)).toBe(true);
  });

  it('costs more each time that night, and a care mistake from the second time (not in Cozy)', () => {
    const s = asleep();
    const before = s.pet.careMistakes;
    wakeAtNight(s.pet, at(1, 23), s.settings);
    s.pet.upLate = null;
    const mood = s.pet.mood;
    expect(wakeAtNight(s.pet, at(1, 23, 30), s.settings)).toBe('mistake');
    expect(s.pet.mood).toBe(mood - 15);
    expect(s.pet.careMistakes).toBe(before + 1);
    const cozy = asleep('cozy');
    wakeAtNight(cozy.pet, at(1, 23), cozy.settings);
    cozy.pet.upLate = null;
    const cozyBefore = cozy.pet.careMistakes;
    expect(wakeAtNight(cozy.pet, at(1, 23, 30), cozy.settings)).toBe('woke');
    expect(cozy.pet.careMistakes).toBe(cozyBefore);
  });

  it('loses the good morning, and starts the next night fresh', () => {
    const s = asleep();
    s.egg.lightsOn = false;
    wakeAtNight(s.pet, at(1, 23), s.settings);
    advance(s, at(2, 7, 1));
    expect(s.pet.wake).not.toBe('morning');
    expect(s.pet.nightWakes).toBe(0);
  });

  it('can’t be woken during the day or evening this way', () => {
    const s = hatched();
    expect(wakeAtNight(s.pet, at(1, 10), s.settings)).toBe('none');
    expect(wakeAtNight(s.pet, at(1, 19), s.settings)).toBe('none');
  });
});

describe('daytime lights and the egg', () => {
  it('has no effect on the egg', () => {
    const lit = newGame(at(1, 9), DEFAULT_SETTINGS, 3);
    const dark = newGame(at(1, 9), DEFAULT_SETTINGS, 3);
    dark.egg.lightsOn = false;
    advance(lit, at(1, 12));
    advance(dark, at(1, 12));
    expect(dark.egg.warmth).toBe(lit.egg.warmth);
    expect(dark.egg.devHours).toBe(lit.egg.devHours);
  });
});
