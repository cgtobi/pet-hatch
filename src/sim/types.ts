export type ElementType = 'ember' | 'tide' | 'bloom' | 'astral';
export type NeglectMode = 'cozy' | 'gentle' | 'classic';
export type EggNeed = 'warmth' | 'humidity' | 'bond';

export interface Settings {
  neglect: NeglectMode;
  /** Local hour (0–23) the player goes to sleep. */
  sleepStart: number;
  /** Local hour (0–23) the player wakes up. */
  sleepEnd: number;
  sound: boolean;
  /** UI language; 'auto' follows the device. */
  language: 'auto' | 'en' | 'de';
}

export interface EggState {
  seed: number;
  laidAt: number;
  /** Secret, rolled once: development hours needed to hatch. */
  baseHours: number;
  /** Secret, rolled once: development fractions at which the visible stage advances. */
  thresholds: number[];
  devHours: number;
  warmth: number;
  humidity: number;
  bond: number;
  lastTurnedAt: number;
  health: number;
  /** Care actually given (only the part that raised a meter), per element. */
  care: { ember: number; tide: number; bloom: number };
  careMistakes: number;
  /** Tracks which needs are currently empty, so each lapse counts as one care mistake. */
  lapsed: { warmth: boolean; humidity: boolean; bond: boolean; turn: boolean };
  readyAt: number | null;
  lightsOn: boolean;
  failed: boolean;
}

export interface PetState {
  type: ElementType;
  seed: number;
  hatchedAt: number;
  /** True when the egg hatched on its own because nobody came back in time. */
  hatchedAlone: boolean;
  revealSeen: boolean;
  health: number;
  careMistakes: number;
}

export interface GameState {
  version: 1;
  phase: 'egg' | 'hatched';
  /** Game time (ms) the simulation has been advanced to. */
  simTime: number;
  /** Game time = real time + offset. Only debug speed/skip changes it. */
  clockOffset: number;
  egg: EggState;
  pet: PetState | null;
  settings: Settings;
}
