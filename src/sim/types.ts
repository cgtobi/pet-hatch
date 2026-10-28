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

export type LifeStage = 'baby' | 'child' | 'teen' | 'adult' | 'elder';
export type PetNeed = 'hunger' | 'mood' | 'energy';
export type PetStatus = 'alive' | 'ranAway' | 'died' | 'retired';

export interface Dropping {
  /** Position on the island, polar: angle (rad) and distance from the center. */
  angle: number;
  dist: number;
  at: number;
  /** How long it has been lying there while the player was awake. */
  awakeHours: number;
  /** Already counted as a care mistake for being left too long. */
  counted: boolean;
}

/** An attention call: 'need' is genuine, 'fake' is a tantrum to be scolded. */
export interface PetCall {
  kind: 'need' | 'fake';
  at: number;
}

export interface PetState {
  type: ElementType;
  seed: number;
  name: string;
  hatchedAt: number;
  /** True when the egg hatched on its own because nobody came back in time. */
  hatchedAlone: boolean;
  revealSeen: boolean;
  status: PetStatus;
  /** 0 = starving … 100 = full. */
  hunger: number;
  mood: number;
  energy: number;
  health: number;
  discipline: number;
  sick: boolean;
  /** Dozing off during the day after running out of energy. */
  napping: boolean;
  /** Medicine doses still needed to cure the current sickness. */
  sickDoses: number;
  droppings: Dropping[];
  /** Game times at which the last meals will come out the other end. */
  poopsDue: number[];
  meals: number;
  call: PetCall | null;
  nextFakeCallAt: number;
  /** Awake hours spent fully neglected (starving and miserable); Gentle mode runs away at a limit. */
  neglectHours: number;
  /** Care mistakes per life stage, for evolution. Index matches LIFE_STAGES. */
  mistakes: number[];
  /** Night (by date key) on which the lights were left on too long; one mistake per night. */
  lightsMistakeNight: string | null;
  /** Total care mistakes, egg included. */
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
