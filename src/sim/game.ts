import { dayPart, HOUR, MINUTE } from './clock';
import { createEgg, eggType, HATCH_WAIT_H, tickEgg } from './egg';
import { topStat } from './evolution';
import { createPet, tickPet } from './pet';
import { randomSeed } from './rng';
import { masteredStats } from './training';
import type { GameState, Heritage, NeglectMode, PetState, Settings } from './types';

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
  while (state.simTime < to) {
    const dt = Math.min(STEP, to - state.simTime);
    const before = dayPart(state.simTime, state.settings);
    state.simTime += dt;
    const after = dayPart(state.simTime, state.settings);
    // Evening makes it dark (the player switches the light on to keep the pet up); morning makes it light again.
    if (after !== before && after !== 'night') state.egg.lightsOn = after === 'day';
    if (state.phase === 'hatched' && state.pet) {
      tickPet(state.pet, state.simTime, dt / HOUR, state.settings, state.egg.lightsOn);
    } else if (state.phase === 'egg') {
      tickEgg(state.egg, state.simTime, dt / HOUR, state.settings);
      const { readyAt } = state.egg;
      if (readyAt !== null && state.simTime - readyAt >= HATCH_WAIT_H * HOUR) {
        hatch(state, state.simTime, true);
      }
    }
  }
}

/** Whether the egg is ready and waiting for the player to help it out. */
export function isReadyToHatch(state: GameState): boolean {
  return state.phase === 'egg' && state.egg.readyAt !== null && !state.egg.failed;
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
 * Replace the finished pet (or failed egg) with a fresh egg, keeping settings and debug clock.
 * The pet joins the family list; only a pet that retired passes something on to the new egg.
 * The new egg is the one moment the neglect mode can change.
 */
export function layNewEgg(state: GameState, now: number, seed = randomSeed(), neglect = state.settings.neglect): void {
  state.settings.neglect = neglect;
  const pet = state.pet;
  const family = [...state.family];
  if (pet) {
    family.push({
      name: pet.name,
      type: pet.type,
      form: pet.form,
      generation: pet.generation,
      ending: pet.status === 'alive' ? 'released' : pet.status,
      wins: pet.battles.wins,
      stars: masteredStats(pet).length,
      hatchedAt: pet.hatchedAt,
      endedAt: now,
    });
  }
  const fresh = newGame(now, state.settings, seed, pet?.status === 'retired' ? heritageOf(pet) : null);
  fresh.clockOffset = state.clockOffset;
  fresh.egg.lightsOn = state.egg.lightsOn;
  fresh.family = family;
  fresh.learned = state.learned;
  Object.assign(state, fresh);
}
