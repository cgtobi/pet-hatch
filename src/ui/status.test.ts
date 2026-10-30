import { describe, expect, it } from 'vitest';
import { HOUR } from '../sim/clock';
import { DEFAULT_SETTINGS, hatch, newGame } from '../sim/game';
import type { PetState } from '../sim/types';
import { crackLevel, eggHint, musicFor, petFeel, petHealth, petHint, type PetContext } from './status';

const settings = { ...DEFAULT_SETTINGS, sleepStart: 22, sleepEnd: 7 };
const at = (hour: number) => new Date(2026, 0, 2, hour).getTime();
const noRush = { left: null, taps: 12 };

function egg() {
  const s = newGame(at(9) - HOUR, settings, 7);
  Object.assign(s.egg, { warmth: 80, humidity: 80, bond: 80, lastTurnedAt: at(9) });
  return s.egg;
}

/** A content, fed, clean, rested pet at 10:00. */
function pet(over: Partial<PetState> = {}): PetState {
  const s = newGame(at(9) - 40 * HOUR, settings, 7);
  hatch(s, at(9) - 30 * HOUR, false);
  return Object.assign(s.pet!, {
    hunger: 80,
    mood: 80,
    energy: 60,
    health: 100,
    discipline: 80,
    sick: false,
    napping: false,
    powerNap: null,
    dozing: false,
    upLate: null,
    call: null,
    droppings: [],
    stage: 1,
    ...over,
  });
}

const ctx = (over: Partial<PetContext> = {}): PetContext => ({ settings, lightsOn: true, knowsNightWake: false, tapped: true, ...over });

describe('egg hint', () => {
  it('asks for the most urgent care first', () => {
    const e = egg();
    e.warmth = 10;
    e.humidity = 10;
    expect(eggHint(e, at(10), settings, noRush)).toEqual({ key: 'hint.cold', urgent: true });
    e.warmth = 80;
    expect(eggHint(e, at(10), settings, noRush)).toEqual({ key: 'hint.dry', urgent: true });
  });

  it('counts the taps to break out, and says it sleeps at night', () => {
    expect(eggHint(egg(), at(10), settings, { left: 5, taps: 12 })).toEqual({ key: 'hint.rush', params: { n: 5 } });
    expect(eggHint(egg(), at(10), settings, { left: 12, taps: 12 }).key).toBe('hint.ready');
    expect(eggHint(egg(), at(23), settings, noRush).key).toBe('hint.sleep');
  });

  it('cracks only from the third stage, fully while breaking out', () => {
    const e = egg();
    expect(crackLevel(e, noRush)).toBe(0);
    e.devHours = e.baseHours;
    e.readyAt = at(10);
    expect(crackLevel(e, { left: 0, taps: 12 })).toBeCloseTo(1);
  });
});

describe('pet hint', () => {
  it('puts sickness before hunger, and hunger before a dirty island', () => {
    expect(petHint(pet({ sick: true, hunger: 10 }), at(10), ctx())).toMatchObject({ key: 'hint.pet.sick', urgent: true });
    expect(petHint(pet({ hunger: 25, droppings: [{ angle: 0, dist: 1, at: 0, awakeHours: 0, counted: false }] }), at(10), ctx())).toMatchObject({
      key: 'hint.pet.hungry',
      urgent: false,
    });
    expect(petHint(pet({ hunger: 10 }), at(10), ctx()).urgent).toBe(true);
  });

  it('explains waking at night until the player has done it', () => {
    expect(petHint(pet(), at(23), ctx({ lightsOn: false })).key).toBe('hint.sleep');
    expect(petHint(pet(), at(23), ctx()).key).toBe('hint.pet.nightWakeTip');
    expect(petHint(pet(), at(23), ctx({ knowsNightWake: true })).key).toBe('hint.lightsNight');
  });

  it('suggests a nap by day only, training when rested, and a first tap', () => {
    expect(petHint(pet({ energy: 20 }), at(10), ctx()).key).toBe('hint.pet.napReady');
    expect(petHint(pet({ energy: 10 }), at(20), ctx()).key).toBe('hint.pet.tired');
    expect(petHint(pet({ energy: 90 }), at(10), ctx()).key).toBe('hint.pet.train');
    expect(petHint(pet(), at(10), ctx({ tapped: false })).key).toBe('hint.pet.tap');
    expect(petHint(pet(), at(10), ctx()).key).toBe('hint.pet.fine');
  });
});

describe('status line and music', () => {
  it('describes how the pet feels and how healthy it is', () => {
    expect(petFeel(pet({ sick: true }), at(10), settings)).toBe('sick');
    expect(petFeel(pet(), at(23), settings)).toBe('sleeping');
    expect(petFeel(pet({ mood: 20 }), at(10), settings)).toBe('sad');
    expect(petHealth(pet({ health: 30 }))).toBe('weak');
    expect(petHealth(pet())).toBe('good');
  });

  it('plays the lullaby from the evening, by the bedtime setting', () => {
    const p = pet();
    expect(musicFor(at(12), settings, { battle: false, dark: false, pet: p })).toBe('day');
    expect(musicFor(at(19), settings, { battle: false, dark: false, pet: p })).toBe('night');
    const late = { ...settings, sleepStart: 2, sleepEnd: 10 };
    expect(musicFor(at(19), late, { battle: false, dark: false, pet: p })).toBe('day');
    expect(musicFor(at(23), settings, { battle: false, dark: true, pet: p })).toBe('off');
    expect(musicFor(at(12), settings, { battle: true, dark: false, pet: p })).toBe('battle');
  });
});
