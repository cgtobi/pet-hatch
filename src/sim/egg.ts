import { HOUR, isAsleep } from './clock';
import { mulberry32 } from './rng';
import type { EggNeed, EggState, ElementType, Heritage, NeglectMode, Settings } from './types';

export const STAGE_NAMES = ['Quiet', 'Stirring', 'Wobbly', 'Cracking', 'Hatching'] as const;

/** Need loss per awake game hour. */
const DECAY: Record<EggNeed, number> = { warmth: 34, humidity: 25, bond: 20 };
const AVERAGE_DECAY = (DECAY.warmth + DECAY.humidity + DECAY.bond) / 3;
const ELEMENT: Record<EggNeed, 'ember' | 'tide' | 'bloom'> = { warmth: 'ember', humidity: 'tide', bond: 'bloom' };
/** Pampering (care beyond full) counts this much more than ordinary care… */
const PAMPER_WEIGHT = 1.5;
/** …up to this many points per need, refilling at the same rate per hour. */
const PAMPER_PER_HOUR = 30;
/** No element above this share of the care: the egg is balanced. */
const BALANCED_SHARE = 0.38;
/** Astral: balanced care with every element pampered at least this much, a healthy egg and few mistakes. */
const ASTRAL_PAMPER = 40;
const ASTRAL_HEALTH = 80;
const ASTRAL_MAX_MISTAKES = 2;
/** Decay multiplier while the player sleeps, lights off vs. left on. */
const SLEEP_DECAY_DARK = 0.1;
const SLEEP_DECAY_LIT = 0.3;
export const TURN_INTERVAL_H = 4;
const MIN_TURN_GAP_H = 0.5;
/** Health loss per awake hour for each unmet need. */
const HEALTH_LOSS = { warmth: 6, humidity: 4, bond: 2, turn: 3 };
const HEALTH_RECOVERY = 3;
const NEGLECT_MULT: Record<NeglectMode, number> = { cozy: 0, gentle: 1, classic: 1.5 };
const GENTLE_HEALTH_FLOOR = 10;
/** A need counts as recovered from a lapse once it is above this. */
const LAPSE_RESET = 20;
/** How long a ready egg waits for the player before hatching on its own. */
export const HATCH_WAIT_H = 12;

const MIN_HATCH_H = 20;
const HATCH_SPREAD_H = 8;
const STAGE_THRESHOLDS = [0.18, 0.42, 0.68, 0.9];
const STAGE_JITTER = 0.08;

export function createEgg(now: number, seed: number, heritage: Heritage | null = null): EggState {
  const rand = mulberry32(seed);
  return {
    seed,
    laidAt: now,
    baseHours: MIN_HATCH_H + rand() * HATCH_SPREAD_H,
    thresholds: STAGE_THRESHOLDS.map((t) => t + (rand() - 0.5) * STAGE_JITTER),
    devHours: 0,
    warmth: 80,
    humidity: 80,
    bond: 60,
    lastTurnedAt: now,
    health: 100,
    care: { ember: 0, tide: 0, bloom: 0 },
    pampered: { ember: 0, tide: 0, bloom: 0 },
    pamperBudget: { warmth: PAMPER_PER_HOUR, humidity: PAMPER_PER_HOUR, bond: PAMPER_PER_HOUR },
    careMistakes: 0,
    lapsed: { warmth: false, humidity: false, bond: false, turn: false },
    readyAt: null,
    lightsOn: true,
    failed: false,
    heritage,
  };
}

const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));

/** Visible stage index into STAGE_NAMES. Deliberately coarse: the exact hatch time stays hidden. */
export function hatchStage(egg: EggState): number {
  if (egg.readyAt !== null) return 4;
  const f = egg.devHours / egg.baseHours;
  return egg.thresholds.filter((t) => f >= t).length;
}

export function hoursSinceTurn(egg: EggState, now: number): number {
  return (now - egg.lastTurnedAt) / HOUR;
}

export function isTurnOverdue(egg: EggState, now: number): boolean {
  return hoursSinceTurn(egg, now) >= TURN_INTERVAL_H;
}

/** Hours until the egg needs turning (0 when overdue). Care info, not hatch info. */
export function hoursUntilTurn(egg: EggState, now: number): number {
  return Math.max(0, TURN_INTERVAL_H - hoursSinceTurn(egg, now));
}

/** Advance the egg by dtH game hours, ending at game time t. */
export function tickEgg(egg: EggState, t: number, dtH: number, settings: Settings): void {
  if (egg.failed) return;
  const asleep = isAsleep(t, settings);
  const decayMul = asleep ? (egg.lightsOn ? SLEEP_DECAY_LIT : SLEEP_DECAY_DARK) : 1;

  for (const need of ['warmth', 'humidity', 'bond'] as const) {
    egg.pamperBudget[need] = Math.min(PAMPER_PER_HOUR, egg.pamperBudget[need] + PAMPER_PER_HOUR * dtH);
  }
  egg.warmth = clamp(egg.warmth - DECAY.warmth * dtH * decayMul);
  egg.humidity = clamp(egg.humidity - DECAY.humidity * dtH * decayMul);
  egg.bond = clamp(egg.bond - DECAY.bond * dtH * decayMul);
  // The turning clock slows down at night along with everything else.
  egg.lastTurnedAt += dtH * HOUR * (1 - decayMul);
  const overdue = isTurnOverdue(egg, t);

  for (const need of ['warmth', 'humidity', 'bond'] as const) {
    if (egg[need] > LAPSE_RESET) egg.lapsed[need] = false;
    else if (egg[need] <= 0 && !egg.lapsed[need] && !asleep) {
      egg.lapsed[need] = true;
      egg.careMistakes++;
    }
  }
  if (!overdue) egg.lapsed.turn = false;
  else if (!egg.lapsed.turn && !asleep) {
    egg.lapsed.turn = true;
    egg.careMistakes++;
  }

  let loss = 0;
  if (!asleep) {
    if (egg.warmth <= 0) loss += HEALTH_LOSS.warmth;
    if (egg.humidity <= 0) loss += HEALTH_LOSS.humidity;
    if (egg.bond <= 0) loss += HEALTH_LOSS.bond;
    if (overdue) loss += HEALTH_LOSS.turn;
  }
  const avg = (egg.warmth + egg.humidity + egg.bond) / 3;
  if (loss > 0) {
    egg.health -= loss * NEGLECT_MULT[settings.neglect] * dtH;
  } else if (Math.min(egg.warmth, egg.humidity, egg.bond) >= 40 && !overdue) {
    egg.health += HEALTH_RECOVERY * dtH;
  }
  egg.health = clamp(egg.health, settings.neglect === 'gentle' ? GENTLE_HEALTH_FLOOR : 0);
  if (settings.neglect === 'classic' && egg.health <= 0) {
    egg.failed = true;
    return;
  }

  if (egg.readyAt === null) {
    // Good care speeds development up a little, neglect slows it down.
    const rate = loss > 0 ? 0.85 : egg.health >= 70 && avg >= 50 ? 1.1 : 1;
    egg.devHours += rate * dtH;
    if (egg.devHours >= egg.baseHours) egg.readyAt = t;
  }
}

export interface CareResult {
  /** How much the meter went up. */
  added: number;
  /** Extra care given beyond full that counted as pampering. */
  pampered: number;
}

/**
 * Give care for one need. What raises the meter counts toward the element, weighted by how fast that need
 * drains: keeping all three going evenly is neutral, whatever their drain speeds. Care beyond full counts
 * as pampering (more strongly, within a budget): that is how the player shows a preference.
 */
function giveCare(egg: EggState, need: EggNeed, amount: number): CareResult {
  const before = egg[need];
  egg[need] = clamp(before + amount);
  const added = egg[need] - before;
  const pampered = Math.max(0, Math.min(amount - added, egg.pamperBudget[need]));
  egg.pamperBudget[need] -= pampered;
  const element = ELEMENT[need];
  egg.pampered[element] += pampered;
  egg.care[element] += added * (AVERAGE_DECAY / DECAY[need]) + pampered * PAMPER_WEIGHT;
  return { added, pampered };
}

export function warmEgg(egg: EggState, amount: number): CareResult {
  return giveCare(egg, 'warmth', amount);
}

export function mistEgg(egg: EggState, amount = 30): CareResult {
  return giveCare(egg, 'humidity', amount);
}

/** Stroking and singing both build the bond. */
export function comfortEgg(egg: EggState, amount: number): CareResult {
  return giveCare(egg, 'bond', amount);
}

/** Scale care recorded under the old rules (raw meter raises) to the drain-weighted points used now. */
export function migrateEggCare(egg: EggState): void {
  if (egg.pampered) return;
  egg.care = {
    ember: egg.care.ember * (AVERAGE_DECAY / DECAY.warmth),
    tide: egg.care.tide * (AVERAGE_DECAY / DECAY.humidity),
    bloom: egg.care.bloom * (AVERAGE_DECAY / DECAY.bond),
  };
  egg.pampered = { ember: 0, tide: 0, bloom: 0 };
  egg.pamperBudget = { warmth: PAMPER_PER_HOUR, humidity: PAMPER_PER_HOUR, bond: PAMPER_PER_HOUR };
}

/** Returns false when the egg was turned too recently to need it. */
export function turnEgg(egg: EggState, now: number): boolean {
  if (hoursSinceTurn(egg, now) < MIN_TURN_GAP_H) return false;
  egg.lastTurnedAt = now;
  egg.lapsed.turn = false;
  return true;
}

export interface Leaning {
  ember: number;
  tide: number;
  bloom: number;
  total: number;
  label: 'Ember' | 'Tide' | 'Bloom' | 'Balanced' | 'Unknown';
}

export function careLeaning(egg: EggState): Leaning {
  const { ember, tide, bloom } = egg.care;
  const total = ember + tide + bloom;
  if (total < 1) return { ember: 1 / 3, tide: 1 / 3, bloom: 1 / 3, total, label: 'Unknown' };
  const shares = { ember: ember / total, tide: tide / total, bloom: bloom / total };
  const top = (Object.keys(shares) as (keyof typeof shares)[]).sort((a, b) => shares[b] - shares[a])[0];
  const label = shares[top] < BALANCED_SHARE ? 'Balanced' : top === 'ember' ? 'Ember' : top === 'tide' ? 'Tide' : 'Bloom';
  return { ...shares, total, label };
}

/**
 * The element the egg hatches into. A clear lean wins. Balanced care is Astral only if all three were
 * pampered and the egg is healthy; otherwise the egg's own seed picks one of the three, evenly.
 */
export function eggType(egg: EggState): ElementType {
  const l = careLeaning(egg);
  if (l.label === 'Balanced' || l.label === 'Unknown') {
    const p = egg.pampered;
    const astral =
      Math.min(p.ember, p.tide, p.bloom) >= ASTRAL_PAMPER &&
      egg.health >= ASTRAL_HEALTH &&
      egg.careMistakes <= ASTRAL_MAX_MISTAKES;
    return astral ? 'astral' : (['ember', 'tide', 'bloom'] as const)[egg.seed % 3];
  }
  return l.label === 'Ember' ? 'ember' : l.label === 'Tide' ? 'tide' : 'bloom';
}
