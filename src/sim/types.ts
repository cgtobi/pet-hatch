export type ElementType = 'ember' | 'tide' | 'bloom' | 'astral';
export type Language = 'en' | 'de' | 'fr' | 'es' | 'it' | 'nl';
export type NeglectMode = 'cozy' | 'gentle' | 'classic';
export type EggNeed = 'warmth' | 'humidity' | 'bond';

export interface Settings {
  neglect: NeglectMode;
  /** Local hour (0–23) the player goes to sleep. */
  sleepStart: number;
  /** Local hour (0–23) the player wakes up. */
  sleepEnd: number;
  sound: boolean;
  music: boolean;
  /** Vibration feedback, where the device supports it. */
  haptics: boolean;
  /** UI language; 'auto' follows the device. */
  language: 'auto' | Language;
}

/** What a retired pet passes on to the egg it leaves behind. */
export interface Heritage {
  parentName: string;
  parentType: ElementType;
  /** Head start per stat: a few points in the parent's best stat, and more for every other stat it had at 100. */
  stats: Partial<Record<Stat, number>>;
  generation: number;
}

/** A past pet, kept for the family list. */
export interface Ancestor {
  name: string;
  type: ElementType;
  form: FormId;
  generation: number;
  /** How its story ended; 'released' means a new egg was started while it was still around. */
  ending: 'retired' | 'ranAway' | 'died' | 'released';
  wins: number;
  /** Stats it had at 100, shown as stars (missing in older saves). */
  stars?: number;
  hatchedAt: number;
  endedAt: number;
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
  /**
   * Care points per element, which decide what hatches: raises weighted by how fast that need drains
   * (so plain keep-alive care stays neutral), plus pampering beyond full.
   */
  care: { ember: number; tide: number; bloom: number };
  /** Extra care given while a need was already full, per element (Astral needs all three). */
  pampered: { ember: number; tide: number; bloom: number };
  /** How much more pampering counts right now, per need; refills over time so spamming doesn't run away. */
  pamperBudget: Record<EggNeed, number>;
  careMistakes: number;
  /** Tracks which needs are currently empty, so each lapse counts as one care mistake. */
  lapsed: { warmth: boolean; humidity: boolean; bond: boolean; turn: boolean };
  readyAt: number | null;
  /** The light on the island (kept with the egg, but it serves the pet): off makes evenings and nights dark. */
  lightsOn: boolean;
  failed: boolean;
  heritage: Heritage | null;
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

export type Stat = 'power' | 'speed' | 'guard' | 'wits';
export type FormId =
  | 'baby'
  | 'child.bright'
  | 'child.scruffy'
  | 'teen.physical'
  | 'teen.technical'
  | 'adult.power'
  | 'adult.speed'
  | 'adult.guard'
  | 'adult.wits';

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
  /** Asleep during the day: an exhaustion nap, or a power nap the player started. */
  napping: boolean;
  /** A power nap the player started with the Nap button (null otherwise). */
  powerNap: { since: number } | null;
  /** Dozing in the evening because the light is off; switching it on wakes the pet. */
  dozing: boolean;
  /** Hours slept in the dark so far tonight; enough of them make a good morning. */
  darkSleepH: number;
  /** Woken at night by the player: awake until this game time, then asleep again (null otherwise). */
  upLate: { until: number } | null;
  /** How often the player woke it this night; reset every morning. */
  nightWakes: number;
  /** The player swept the old eggshell away (otherwise it weathers away over SHELL_DAYS). */
  shellSwept: boolean;
  /** How the pet last woke on its own (from a power nap, or in the morning), for the game to announce once. */
  wake: 'rested' | 'need' | 'morning' | 'backToSleep' | null;
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
  /** Total care mistakes, egg included. */
  careMistakes: number;
  /** Life stage index the simulation has processed (evolution happens when it moves on). */
  stage: number;
  form: FormId;
  /** The stage and form the player has seen, so evolutions that happened while away still play. */
  shownStage: number;
  shownForm: FormId;
  stats: Record<Stat, number>;
  /**
   * Trained like a stat (same caps) but not used in battle: it raises the most energy the pet can have,
   * so it can train, play and fight longer (see maxEnergy).
   */
  endurance: number;
  /** Finished training sessions. */
  trainings: number;
  /** Every form taken so far, in order (the teen form decides one of the adult's moves). */
  path: FormId[];
  battles: { wins: number; losses: number };
  /** Battle experience toward the next stat point (0 … XP_PER_POINT). */
  battleXp: number;
  /** Stats opponents taught it by beating it, oldest first; a full experience bar trains one of them. */
  lessons: { stat: Stat; from: string }[];
  /** 1 for a first pet; each retired parent's egg adds one. */
  generation: number;
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
  /** Earlier pets, oldest first. */
  family: Ancestor[];
  /** One-time tips the player no longer needs (missing in older saves). */
  learned?: { nightWake?: boolean; lightTip?: boolean };
}
