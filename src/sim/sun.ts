import { EVENING_H } from './clock';
import type { Settings } from './types';

/** Without a sleep window the sun keeps these hours. */
const DEFAULT_RISE = 7;
const DEFAULT_SET = 19;
/** Keeps the sun's day sensible for odd sleep windows. */
const MIN_DAY_H = 6;
const MAX_DAY_H = 20;
/** Twilight: the sky glows this many hours either side of sunrise and sunset. */
export const TWILIGHT_H = 1.5;

const DAY_MS = 86_400_000;
const SYNODIC_DAYS = 29.530588853;
/** A known new moon: 6 January 2000, 18:14 UTC. */
const NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14);

export interface SunState {
  /** Signed hours from the horizon: while the sun is up, hours to the nearer of sunrise and sunset; negative at night. */
  fromHorizon: number;
  /** The sun's way across the sky: 0 at sunrise, 1 at sunset, a little beyond either during twilight. */
  sun: number;
  /** The moon's way across the night sky: 0 at sunset, 1 at sunrise. */
  moon: number;
  /** Moon phase: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter. */
  phase: number;
}

/**
 * Sunrise at the player's wake-up time, sunset when the evening starts (EVENING_H before bedtime), so the
 * sky matches the game: the light switches itself on at sunrise and off at sunset.
 */
export function sunTimes(settings: Settings): { rise: number; set: number; day: number } {
  const { sleepStart: s, sleepEnd: e } = settings;
  if (s === e) return { rise: DEFAULT_RISE, set: DEFAULT_SET, day: DEFAULT_SET - DEFAULT_RISE };
  const awake = (((s - EVENING_H - e) % 24) + 24) % 24;
  const day = Math.min(MAX_DAY_H, Math.max(MIN_DAY_H, awake));
  return { rise: e, set: (e + day) % 24, day };
}

export function moonPhase(t: number): number {
  const days = (t - NEW_MOON_MS) / DAY_MS;
  return (((days / SYNODIC_DAYS) % 1) + 1) % 1;
}

/** Where the sun and moon are at a local hour (0–24) on day t. */
export function sunAt(hour: number, t: number, settings: Settings): SunState {
  const { rise, day } = sunTimes(settings);
  const night = 24 - day;
  const sinceRise = (((hour - rise) % 24) + 24) % 24;
  const phase = moonPhase(t);
  if (sinceRise < day) {
    return { fromHorizon: Math.min(sinceRise, day - sinceRise), sun: sinceRise / day, moon: -1, phase };
  }
  const sinceSet = sinceRise - day;
  return {
    fromHorizon: -Math.min(sinceSet, night - sinceSet),
    // Just after sunset the sun sinks past 1; before sunrise it climbs towards 0.
    sun: sinceSet < night / 2 ? sinceRise / day : (sinceRise - 24) / day,
    moon: sinceSet / night,
    phase,
  };
}
