import { HOUR, MINUTE } from './clock';
import { createEgg, eggType, HATCH_WAIT_H, tickEgg } from './egg';
import { topStat } from './evolution';
import { createPet, tickPet } from './pet';
import { randomSeed } from './rng';
import type { GameState, Heritage, PetState, Settings } from './types';

/** Fixed simulation step; catch-up replays missed time in these slices. */
const STEP = MINUTE;
/** Never replay more than this much missed time (keeps load fast after long absences). */
const MAX_CATCH_UP = 14 * 24 * HOUR;

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
    state.simTime += dt;
    if (state.phase === 'hatched' && state.pet) {
      const napEnd = tickPet(state.pet, state.simTime, dt / HOUR, state.settings, state.egg.lightsOn);
      // A power nap that ends on its own switches the lights back on (bedtime keeps them off).
      if (napEnd === 'rested' || napEnd === 'need') state.egg.lightsOn = true;
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

/** What a retiring pet passes on: a head start of about a tenth of its best stat (3–8 points). */
export function heritageOf(pet: PetState): Heritage {
  const stat = topStat(pet);
  return {
    parentName: pet.name,
    parentType: pet.type,
    stat,
    bonus: Math.min(8, Math.max(3, Math.round(pet.stats[stat] * 0.1))),
    generation: pet.generation + 1,
  };
}

/**
 * Replace the finished pet (or failed egg) with a fresh egg, keeping settings and debug clock.
 * The pet joins the family list; only a pet that retired passes something on to the new egg.
 */
export function layNewEgg(state: GameState, now: number, seed = randomSeed()): void {
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
      hatchedAt: pet.hatchedAt,
      endedAt: now,
    });
  }
  const fresh = newGame(now, state.settings, seed, pet?.status === 'retired' ? heritageOf(pet) : null);
  fresh.clockOffset = state.clockOffset;
  fresh.egg.lightsOn = state.egg.lightsOn;
  fresh.family = family;
  Object.assign(state, fresh);
}
