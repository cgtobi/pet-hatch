import type { Settings } from './types';

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

/** Fractional local hour of day (0–24) for a game timestamp. */
export function localHour(t: number): number {
  const d = new Date(t);
  return d.getHours() + d.getMinutes() / 60;
}

/** Whether the player is (supposed to be) asleep at game time t. */
export function isAsleep(t: number, settings: Settings): boolean {
  const h = localHour(t);
  const { sleepStart: s, sleepEnd: e } = settings;
  if (s === e) return false;
  return s < e ? h >= s && h < e : h >= s || h < e;
}
