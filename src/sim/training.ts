import { isAsleep, MINUTE } from './clock';
import { mulberry32 } from './rng';
import type { ElementType, PetState, Settings, Stat } from './types';

export const STATS: Stat[] = ['power', 'speed', 'guard', 'wits'];
/** Highest value each stat can reach, by life stage index (babies are too young to train). */
export const STAT_CAPS = [0, 30, 60, 100, 100];
/** Each type learns its favorite stat a little faster. */
export const FAVORITE: Record<ElementType, Stat> = { ember: 'power', tide: 'speed', bloom: 'guard', astral: 'wits' };
export const TRAIN_ENERGY = 20;
const TRAIN_HUNGER = 6;
const MIN_HUNGER = 15;
/** Below this discipline the pet may throw a tantrum instead of training. */
const OBEY_DISCIPLINE = 40;
const MAX_REFUSAL = 0.3;
/** A pet woken at night is grumpy and refuses this much more often. */
const UP_LATE_REFUSAL = 0.25;

export type TrainCheck = 'ok' | 'baby' | 'asleep' | 'sick' | 'tired' | 'hungry';

const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));

/** Whether the pet is in a state to train (or battle, with its own energy need), and why not. */
export function canTrain(pet: PetState, now: number, settings: Settings, minEnergy = TRAIN_ENERGY): TrainCheck {
  if (pet.stage < 1) return 'baby';
  if (pet.napping || pet.dozing || (isAsleep(now, settings) && !pet.upLate)) return 'asleep';
  if (pet.sick) return 'sick';
  if (pet.energy < minEnergy) return 'tired';
  if (pet.hunger < MIN_HUNGER) return 'hungry';
  return 'ok';
}

/** Chance that a poorly disciplined (or woken-up, grumpy) pet refuses to train and throws a tantrum instead. */
export function refusalChance(pet: PetState): number {
  return MAX_REFUSAL * clamp(1 - pet.discipline / OBEY_DISCIPLINE, 0, 1) + (pet.upLate ? UP_LATE_REFUSAL : 0);
}

/**
 * Called when a session starts. A pet with little discipline may refuse; it then throws a tantrum
 * (a fake call) that scolding fixes. Deterministic per minute and session count.
 */
export function startTraining(pet: PetState, now: number): 'ok' | 'refused' {
  const r = mulberry32(pet.seed ^ Math.floor(now / MINUTE) ^ ((pet.trainings + 1) * 0x2545f491))();
  if (r >= refusalChance(pet)) return 'ok';
  pet.call = { kind: 'fake', at: now };
  return 'refused';
}

export function statCap(pet: PetState): number {
  return STAT_CAPS[Math.min(pet.stage, STAT_CAPS.length - 1)];
}

/** Points a session earns before the cap: 1 … 6 by score, faster for the favorite stat. */
export function trainGain(pet: PetState, stat: Stat, score: number): number {
  let gain = 1 + 5 * clamp(score, 0, 1);
  if (FAVORITE[pet.type] === stat) gain *= 1.25;
  if (pet.form === 'child.scruffy') gain *= 0.8;
  if (pet.stage >= 4) gain *= 0.5;
  return Math.max(1, Math.round(gain));
}

export interface TrainResult {
  gain: number;
  /** The stat had already hit (or just hit) this stage's cap. */
  capped: boolean;
}

/** Apply a finished session: score is 0 … 1 from the minigame. */
export function finishTraining(pet: PetState, stat: Stat, score: number): TrainResult {
  const cap = statCap(pet);
  const gain = Math.max(0, Math.min(trainGain(pet, stat, score), cap - pet.stats[stat]));
  pet.stats[stat] += gain;
  pet.trainings++;
  pet.energy = clamp(pet.energy - TRAIN_ENERGY);
  pet.hunger = clamp(pet.hunger - TRAIN_HUNGER);
  pet.mood = clamp(pet.mood + (score >= 0.5 ? 6 : -3));
  return { gain, capped: pet.stats[stat] >= cap };
}

export type Grade = 'excellent' | 'great' | 'good' | 'poor';

export function grade(score: number): Grade {
  return score >= 0.85 ? 'excellent' : score >= 0.6 ? 'great' : score >= 0.3 ? 'good' : 'poor';
}
