import { describe, expect, it } from 'vitest';
import { predictAlerts } from './alerts';
import { atSchool, DEFAULT_SCHOOL, HOUR, MINUTE, schoolStart } from './clock';
import { advance, DEFAULT_SETTINGS, hatch, isAway, newGame, pickUp } from './game';
import type { GameState, NeglectMode, Settings } from './types';

// Local-time timestamps. 5 January 2026 is a Monday; the sleep window is 22:00–07:00.
const at = (day: number, hour: number, minute = 0) => new Date(2026, 0, day, hour, minute).getTime();

const SCHOOL: Settings = { ...DEFAULT_SETTINGS, neglect: 'gentle', school: { ...DEFAULT_SCHOOL, on: true } };

function game(phase: 'egg' | 'pet', start: number, neglect: NeglectMode = 'gentle'): GameState {
  const state = newGame(start, { ...SCHOOL, neglect }, 42);
  if (phase === 'pet') hatch(state, start, false).revealSeen = true;
  return state;
}

describe('school time', () => {
  it('covers the chosen weekdays and hours, from the start of the first hour to the start of the last', () => {
    expect(atSchool(at(5, 7, 59), SCHOOL)).toBe(false);
    expect(atSchool(at(5, 8), SCHOOL)).toBe(true);
    expect(atSchool(at(5, 12, 59), SCHOOL)).toBe(true);
    expect(atSchool(at(5, 13), SCHOOL)).toBe(false);
    // Saturday and Sunday are off by default.
    expect(atSchool(at(3, 10), SCHOOL)).toBe(false);
    expect(atSchool(at(4, 10), SCHOOL)).toBe(false);
    expect(schoolStart(at(5, 10, 30), SCHOOL)).toBe(at(5, 8));
  });

  it('is off when switched off, in Classic, and where the night overlaps it', () => {
    expect(atSchool(at(5, 10), { ...SCHOOL, school: { ...DEFAULT_SCHOOL, on: false } })).toBe(false);
    expect(atSchool(at(5, 10), { ...SCHOOL, neglect: 'classic' })).toBe(false);
    const early = { ...SCHOOL, school: { ...DEFAULT_SCHOOL, on: true, from: 6 } };
    expect(atSchool(at(5, 6, 30), early)).toBe(false);
    expect(atSchool(at(5, 7), early)).toBe(true);
  });

  it('is off for the rest of the day once picked up early, and on again the next school day', () => {
    expect(atSchool(at(5, 11), SCHOOL, at(5, 10))).toBe(false);
    expect(atSchool(at(6, 9), SCHOOL, at(5, 10))).toBe(true);
    // Picked up before school started (the day before): school still happens.
    expect(atSchool(at(5, 9), SCHOOL, at(4, 18))).toBe(true);
  });

  it('holds the pet’s needs, makes no mistakes and drops an open call, but it keeps growing', () => {
    const state = game('pet', at(5, 7, 50));
    const pet = state.pet!;
    pet.hunger = 25;
    pet.mood = 15;
    advance(state, at(5, 7, 59));
    expect(pet.call).not.toBeNull();
    const mistakes = pet.careMistakes;
    advance(state, at(5, 8, 1));
    const before = { hunger: pet.hunger, mood: pet.mood, energy: pet.energy, health: pet.health };
    advance(state, at(5, 12, 59));
    expect(pet.call).toBeNull();
    expect(pet.careMistakes).toBe(mistakes);
    expect({ hunger: pet.hunger, mood: pet.mood, energy: pet.energy, health: pet.health }).toEqual(before);
    expect(pet.droppings).toHaveLength(0);
    // Past the 24-hour baby stage while at day care: it grew up as usual.
    advance(state, at(6, 12));
    expect(pet.stage).toBe(1);
  });

  it('lets the pet need the player again once it is back', () => {
    const state = game('pet', at(5, 8));
    state.pet!.hunger = 10;
    advance(state, at(5, 12, 59));
    expect(state.pet!.call).toBeNull();
    advance(state, at(5, 13, 1));
    expect(state.pet!.call).not.toBeNull();
  });

  it('holds the egg’s needs and turning clock while it keeps developing', () => {
    const state = game('egg', at(5, 8));
    const egg = state.egg;
    const before = { warmth: egg.warmth, humidity: egg.humidity, bond: egg.bond };
    advance(state, at(5, 12, 59));
    expect({ warmth: egg.warmth, humidity: egg.humidity, bond: egg.bond }).toEqual(before);
    expect(egg.careMistakes).toBe(0);
    expect(egg.lastTurnedAt).toBe(at(5, 12, 59));
    expect(egg.devHours).toBeCloseTo(5 - 1 / 60, 5);
  });

  it('keeps a ready egg waiting at day care instead of hatching on its own', () => {
    const state = game('egg', at(5, 8));
    state.egg.devHours = state.egg.baseHours;
    state.egg.readyAt = at(5, 0);
    // 13 hours after it got ready, but 5 of them at day care: still waiting.
    advance(state, at(5, 12, 59));
    expect(state.phase).toBe('egg');
    expect(state.egg.readyAt).toBe(at(5, 0) + 5 * HOUR - MINUTE);
    advance(state, at(5, 17, 2));
    expect(state.phase).toBe('hatched');
  });

  it('picking up early brings it home: care and calls go on from there', () => {
    const state = game('pet', at(5, 9));
    state.pet!.hunger = 10;
    advance(state, at(5, 10));
    expect(isAway(state, state.simTime)).toBe(true);
    pickUp(state, at(5, 10));
    advance(state, at(5, 10, 2));
    expect(isAway(state, state.simTime)).toBe(false);
    expect(state.pet!.call).not.toBeNull();
  });

  it('sends no alerts during school time, and none saved up from the night', () => {
    // School starts right when the night ends.
    const state = game('egg', at(4, 22, 30));
    state.settings.school!.from = 7;
    state.egg.warmth = 21;
    const alerts = predictAlerts(state, at(4, 22, 30));
    expect(alerts.length).toBeGreaterThan(0);
    for (const [t] of alerts) expect(atSchool(t, state.settings)).toBe(false);
    // Cold by the morning: the alert waits until the egg is back from day care.
    expect(alerts[0]).toEqual([at(5, 13), 'egg']);
  });

  it('changes nothing in Classic', () => {
    const plain = newGame(at(5, 8), { ...DEFAULT_SETTINGS, neglect: 'classic' }, 42);
    const school = game('egg', at(5, 8), 'classic');
    advance(plain, at(5, 13));
    advance(school, at(5, 13));
    expect(school.egg).toEqual(plain.egg);
  });
});
