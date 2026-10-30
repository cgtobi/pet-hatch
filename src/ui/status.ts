/**
 * What the status card and hint say about the egg or pet, as plain rules: they pick text keys (checked by the
 * type checker) and leave the wording to i18n, so they can be tested without a screen.
 */
import type { MusicMode } from '../feedback';
import type { TextKey } from '../i18n';
import { dayPart, isAsleep } from '../sim/clock';
import { careLeaning, hatchStage, hoursUntilTurn, isTurnOverdue } from '../sim/egg';
import { POWER_NAP_BELOW } from '../sim/pet';
import { canTrain } from '../sim/training';
import type { EggState, PetState, Settings } from '../sim/types';

export interface Hint {
  key: TextKey;
  params?: Record<string, string | number>;
  /** Shown in red: something needs doing now. */
  urgent?: boolean;
}

/** Taps left to break out of the shell once the egg is ready (null before that). */
export interface Rush {
  left: number | null;
  taps: number;
}

export function eggHint(egg: EggState, now: number, settings: Settings, rush: Rush): Hint {
  if (rush.left !== null) return rush.left < rush.taps ? { key: 'hint.rush', params: { n: rush.left } } : { key: 'hint.ready' };
  if (isAsleep(now, settings)) return { key: 'hint.sleep' };
  if (egg.warmth < 20) return { key: 'hint.cold', urgent: true };
  if (isTurnOverdue(egg, now)) return { key: 'hint.turnNow', urgent: true };
  if (egg.humidity < 20) return { key: 'hint.dry', urgent: true };
  if (egg.bond < 20) return { key: 'hint.lonely', urgent: true };
  if (careLeaning(egg).total < 40) return { key: 'hint.firstTime' };
  const h = hoursUntilTurn(egg, now);
  return h < 1 ? { key: 'hint.turnSoonest' } : { key: 'hint.turnSoon', params: { h: Math.round(h) } };
}

export interface PetContext {
  settings: Settings;
  lightsOn: boolean;
  /** The player has woken the pet at night before, so the how-to tip isn't needed any more. */
  knowsNightWake: boolean;
  /** The player has tapped the pet at least once. */
  tapped: boolean;
}

/** The most pressing thing to say about the pet, in order of importance. */
export function petHint(pet: PetState, now: number, c: PetContext): Hint {
  const params = { name: pet.name };
  if (pet.upLate) return { key: 'hint.pet.upLate', params };
  if (isAsleep(now, c.settings)) {
    if (!c.lightsOn) return { key: 'hint.sleep' };
    // With the light on, how to wake it is explained until the player has done it once.
    return { key: c.knowsNightWake ? 'hint.lightsNight' : 'hint.pet.nightWakeTip', params };
  }
  if (pet.powerNap) return { key: 'hint.pet.powerNap', params };
  if (pet.napping) return { key: 'hint.pet.napping', params };
  if (pet.dozing) return { key: 'hint.pet.dozing', params };
  if (pet.sick) return { key: 'hint.pet.sick', params, urgent: true };
  if (pet.call?.kind === 'fake') return { key: 'hint.pet.callFake', params, urgent: true };
  if (pet.hunger < 30) return { key: 'hint.pet.hungry', params, urgent: pet.hunger < 20 };
  if (pet.droppings.length) return { key: 'hint.pet.dirty', urgent: pet.droppings.length > 1 };
  if (pet.mood < 30) return { key: 'hint.pet.bored', params, urgent: pet.mood < 20 };
  if (pet.call) return { key: 'hint.pet.callNeed', params, urgent: true };
  if (pet.energy < POWER_NAP_BELOW && dayPart(now, c.settings) === 'day') return { key: 'hint.pet.napReady', params };
  if (pet.energy < 20) return { key: 'hint.pet.tired', params };
  if (pet.energy >= 80 && canTrain(pet, now, c.settings) === 'ok') return { key: 'hint.pet.train', params };
  return { key: c.tapped ? 'hint.pet.fine' : 'hint.pet.tap', params };
}

export type Feel = 'sick' | 'upLate' | 'sleeping' | 'napping' | 'dozing' | 'happy' | 'ok' | 'sad';

/** How the pet feels, for the status line. */
export function petFeel(pet: PetState, now: number, settings: Settings): Feel {
  if (pet.sick) return 'sick';
  if (pet.upLate) return 'upLate';
  if (isAsleep(now, settings)) return 'sleeping';
  if (pet.napping) return 'napping';
  if (pet.dozing) return 'dozing';
  return pet.mood >= 60 ? 'happy' : pet.mood >= 30 ? 'ok' : 'sad';
}

export type Health = 'sick' | 'weak' | 'good';

export function petHealth(pet: PetState): Health {
  return pet.sick ? 'sick' : pet.health < 40 ? 'weak' : 'good';
}

/** Battle music in a fight, a lullaby in the evening and at night (by the bedtime setting), silence in the dark. */
export function musicFor(now: number, settings: Settings, o: { battle: boolean; dark: boolean; pet: PetState | null }): MusicMode {
  if (o.battle) return 'battle';
  const asleep = isAsleep(now, settings);
  if (asleep && o.dark) return 'off';
  return asleep || o.pet?.napping || o.pet?.dozing || dayPart(now, settings) !== 'day' ? 'night' : 'day';
}

/** How far the shell has cracked (0 … 1): from the third egg stage on, and the last bit while breaking out. */
export function crackLevel(egg: EggState, rush: Rush): number {
  if (hatchStage(egg) < 3) return 0;
  if (egg.readyAt !== null) return 0.85 + 0.15 * (rush.left === null ? 0 : 1 - rush.left / rush.taps);
  const from = egg.thresholds[2];
  const f = egg.devHours / egg.baseHours;
  return 0.15 + 0.6 * Math.min(1, Math.max(0, (f - from) / (1 - from)));
}
