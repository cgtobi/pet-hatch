import type { SchoolTime, Settings } from './types';

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

/** The evening lasts this many hours before bedtime: it gets dark, and a pet dozes off unless the light is on. */
export const EVENING_H = 4;

export type DayPart = 'day' | 'evening' | 'night';

/** Day, the evening before bedtime, or night (the sleep window). Without a sleep window it is always day. */
export function dayPart(t: number, settings: Settings): DayPart {
  if (isAsleep(t, settings)) return 'night';
  const { sleepStart: s, sleepEnd: e } = settings;
  if (s === e) return 'day';
  const untilBedtime = (s - localHour(t) + 24) % 24;
  return untilBedtime > 0 && untilBedtime <= EVENING_H ? 'evening' : 'day';
}

/** School time lasts at most this many hours a day. */
export const SCHOOL_MAX_H = 10;
export const DEFAULT_SCHOOL: SchoolTime = { on: false, days: [1, 2, 3, 4, 5], from: 8, to: 13 };

/**
 * When today's school time began, if game time t falls within it (null otherwise). Not in Classic, where the
 * pet needs the player every day; and the night wins where the two overlap.
 */
export function schoolStart(t: number, settings: Settings): number | null {
  const s = settings.school;
  if (!s?.on || settings.neglect === 'classic' || isAsleep(t, settings)) return null;
  const d = new Date(t);
  const h = localHour(t);
  if (!s.days.includes(d.getDay()) || h < s.from || h >= s.to) return null;
  d.setHours(s.from, 0, 0, 0);
  return d.getTime();
}

/** Whether the egg or pet is at day care at game time t: school time, unless it was picked up early that day. */
export function atSchool(t: number, settings: Settings, pickedUpAt = -Infinity): boolean {
  const start = schoolStart(t, settings);
  return start !== null && pickedUpAt < start;
}
