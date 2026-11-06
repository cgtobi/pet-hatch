import { rememberRaised } from './book';
import { atSchool, dayPart, HOUR, MINUTE } from './clock';
import { createEgg, eggType, HATCH_WAIT_H, tickEgg } from './egg';
import { topStat } from './evolution';
import { createPet, tickPet } from './pet';
import { randomSeed } from './rng';
import { masteredStats } from './training';
import type { Ancestor, GameState, Heritage, NeglectMode, PetState, Settings } from './types';

/** Fixed simulation step; catch-up replays missed time in these slices. */
const STEP = MINUTE;
/** Never replay more than this much missed time (keeps load fast after long absences). */
const MAX_CATCH_UP = 14 * 24 * HOUR;

/** Gentlest first. Chosen when an egg is started and fixed until the next one. */
export const NEGLECT_MODES: NeglectMode[] = ['cozy', 'gentle', 'classic'];

export const DEFAULT_SETTINGS: Settings = {
  neglect: 'gentle',
  sleepStart: 22,
  sleepEnd: 7,
  sound: true,
  music: true,
  haptics: true,
  language: 'auto',
};

export function newGame(
  now: number,
  settings: Settings = DEFAULT_SETTINGS,
  seed = randomSeed(),
  heritage: Heritage | null = null,
): GameState {
  return {
    version: 1,
    phase: 'egg',
    simTime: now,
    clockOffset: 0,
    egg: createEgg(now, seed, heritage),
    pet: null,
    settings: { ...settings },
    family: [],
  };
}

/** Current game time: real time plus any debug offset. */
export function gameNow(state: GameState, realNow = Date.now()): number {
  return realNow + state.clockOffset;
}

/** Simulate everything that happened between state.simTime and `to`. */
export function advance(state: GameState, to: number): void {
  if (to - state.simTime > MAX_CATCH_UP) state.simTime = to - MAX_CATCH_UP;
  if (state.phase === 'hatched' && state.pet?.status === 'retired') handOver(state, state.simTime);
  while (state.simTime < to) {
    const dt = Math.min(STEP, to - state.simTime);
    const before = dayPart(state.simTime, state.settings);
    state.simTime += dt;
    const after = dayPart(state.simTime, state.settings);
    // Evening makes it dark (the player switches the light on to keep the pet up); morning makes it light again.
    if (after !== before && after !== 'night') state.egg.lightsOn = after === 'day';
    const away = isAway(state, state.simTime);
    if (state.phase === 'hatched' && state.pet) {
      tickPet(state.pet, state.simTime, dt / HOUR, state.settings, state.egg.lightsOn, away);
      if (state.pet.status === 'retired') handOver(state, state.simTime);
    } else if (state.phase === 'egg') {
      tickEgg(state.egg, state.simTime, dt / HOUR, state.settings, away);
      const { readyAt } = state.egg;
      if (readyAt !== null && !state.egg.fading && state.simTime - readyAt >= HATCH_WAIT_H * HOUR) {
        hatch(state, state.simTime, true);
      }
    }
  }
}

/** Whether the egg or pet is at day care (School time) at game time t. */
export function isAway(state: GameState, t: number): boolean {
  return atSchool(t, state.settings, state.pickedUpAt);
}

/** Bring the egg or pet home from day care early: the rest of today's school time is off. */
export function pickUp(state: GameState, now: number): void {
  state.pickedUpAt = now;
}

/** Whether the egg is ready and waiting for the player to help it out. */
export function isReadyToHatch(state: GameState): boolean {
  return state.phase === 'egg' && state.egg.readyAt !== null && !state.egg.failed && !state.egg.fading;
}

export function hatch(state: GameState, at: number, alone: boolean): PetState {
  const pet = createPet(state.egg, eggType(state.egg), at, alone);
  state.phase = 'hatched';
  state.pet = pet;
  return pet;
}

/** Every stat at 100 besides the best one passes on this many points too. */
export const MASTERED_BONUS = 5;

/**
 * What a retiring pet passes on: a head start of about a tenth of its best stat (3–8 points), plus
 * MASTERED_BONUS for every other stat at 100. The best stat comes first.
 */
export function heritageOf(pet: PetState): Heritage {
  const best = topStat(pet);
  const stats: Heritage['stats'] = { [best]: Math.min(8, Math.max(3, Math.round(pet.stats[best] * 0.1))) };
  for (const s of masteredStats(pet)) stats[s] ??= MASTERED_BONUS;
  return { parentName: pet.name, parentType: pet.type, stats, generation: pet.generation + 1 };
}

/**
 * An elder's time is up: the egg that rested in the nest all through its elder week wakes up, inheriting from it,
 * and the elder stays (needs paused, no calls) until the egg hatches. The egg then develops as any egg does; its
 * seed comes from the elder's, so catching up gives the same egg.
 */
export function handOver(state: GameState, now: number): void {
  const pet = state.pet;
  if (!pet) return;
  rememberRaised(state, pet.type, pet.path);
  const egg = createEgg(now, Math.imul(pet.seed ^ 0x5eed, 0x9e3779b1) >>> 0, heritageOf(pet));
  egg.lightsOn = state.egg.lightsOn;
  state.island ??= state.egg.seed;
  state.elder = { pet, laidAt: state.egg.laidAt, told: false };
  state.egg = egg;
  state.phase = 'egg';
  state.pet = null;
}

/** The elder said goodbye after its egg hatched: it sets off on its adventure and joins the family list. */
export function elderLeaves(state: GameState, now: number): void {
  if (!state.elder) return;
  state.family = [...state.family, ancestorOf(state.elder.pet, now)];
  delete state.elder;
}

function ancestorOf(pet: PetState, now: number): Ancestor {
  return {
    name: pet.name,
    type: pet.type,
    form: pet.form,
    generation: pet.generation,
    ending: pet.status === 'alive' ? 'released' : pet.status,
    wins: pet.battles.wins,
    stars: masteredStats(pet).length,
    ...(pet.vialUsed ? { saved: true } : {}),
    hatchedAt: pet.hatchedAt,
    endedAt: now,
  };
}

/**
 * Replace the finished pet (or failed egg) with a fresh egg, keeping settings and debug clock.
 * The pet joins the family list; only a pet that retired passes something on to the new egg.
 * The new egg is the one moment the neglect mode can change.
 */
export function layNewEgg(state: GameState, now: number, seed = randomSeed(), neglect = state.settings.neglect): void {
  state.settings.neglect = neglect;
  const pet = state.pet;
  const family = [...state.family];
  // An elder still waiting for its egg leaves now.
  if (state.elder) family.push(ancestorOf(state.elder.pet, now));
  if (pet) {
    // Its forms stay in the species book.
    rememberRaised(state, pet.type, pet.path);
    family.push(ancestorOf(pet, now));
  }
  const fresh = newGame(now, state.settings, seed, pet?.status === 'retired' ? heritageOf(pet) : null);
  fresh.clockOffset = state.clockOffset;
  fresh.egg.lightsOn = state.egg.lightsOn;
  fresh.family = family;
  fresh.learned = state.learned;
  fresh.book = state.book;
  // A fresh start gets a fresh island.
  delete state.elder;
  delete state.island;
  Object.assign(state, fresh);
}
