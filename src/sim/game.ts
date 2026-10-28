import { HOUR, MINUTE } from './clock';
import { createEgg, eggType, HATCH_WAIT_H, tickEgg } from './egg';
import { randomSeed } from './rng';
import type { GameState, PetState, Settings } from './types';

/** Fixed simulation step; catch-up replays missed time in these slices. */
const STEP = MINUTE;
/** Never replay more than this much missed time (keeps load fast after long absences). */
const MAX_CATCH_UP = 14 * 24 * HOUR;

export const DEFAULT_SETTINGS: Settings = {
  neglect: 'gentle',
  sleepStart: 22,
  sleepEnd: 7,
  sound: true,
  language: 'auto',
};

export function newGame(now: number, settings: Settings = DEFAULT_SETTINGS, seed = randomSeed()): GameState {
  return {
    version: 1,
    phase: 'egg',
    simTime: now,
    clockOffset: 0,
    egg: createEgg(now, seed),
    pet: null,
    settings: { ...settings },
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
    if (state.phase === 'egg') {
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
  const { egg } = state;
  const pet: PetState = {
    type: eggType(egg),
    seed: egg.seed,
    hatchedAt: at,
    hatchedAlone: alone,
    revealSeen: false,
    health: egg.health,
    careMistakes: egg.careMistakes,
  };
  state.phase = 'hatched';
  state.pet = pet;
  return pet;
}
