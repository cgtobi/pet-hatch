import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './game';
import { moonPhase, sunAt, sunTimes } from './sun';

const T = Date.UTC(2026, 9, 30, 12);
const settings = { ...DEFAULT_SETTINGS, sleepStart: 23, sleepEnd: 5 };

describe('sun and moon', () => {
  it('rises at wake-up time and sets when the evening starts', () => {
    expect(sunTimes(settings)).toEqual({ rise: 5, set: 19, day: 14 });
    expect(sunTimes(DEFAULT_SETTINGS)).toEqual({ rise: 7, set: 18, day: 11 });
    expect(sunTimes({ ...settings, sleepStart: 2, sleepEnd: 10 })).toEqual({ rise: 10, set: 22, day: 12 });
  });

  it('keeps a sensible day without a sleep window or with a very short one', () => {
    expect(sunTimes({ ...settings, sleepStart: 0, sleepEnd: 0 })).toEqual({ rise: 7, set: 19, day: 12 });
    expect(sunTimes({ ...settings, sleepStart: 23, sleepEnd: 19 }).day).toBe(6);
  });

  it('counts hours from the horizon: positive by day, negative by night, zero at sunrise and sunset', () => {
    expect(sunAt(5, T, settings).fromHorizon).toBe(0);
    expect(sunAt(12, T, settings).fromHorizon).toBe(7);
    expect(sunAt(18, T, settings).fromHorizon).toBe(1);
    expect(sunAt(19, T, settings).fromHorizon).toBeCloseTo(0);
    expect(sunAt(20, T, settings).fromHorizon).toBe(-1);
    expect(sunAt(0, T, settings).fromHorizon).toBe(-5);
    expect(sunAt(4.5, T, settings).fromHorizon).toBe(-0.5);
  });

  it('moves the sun across by day, a little beyond in twilight, and the moon across by night', () => {
    expect(sunAt(12, T, settings).sun).toBeCloseTo(0.5);
    expect(sunAt(19.5, T, settings).sun).toBeGreaterThan(1);
    expect(sunAt(4.5, T, settings).sun).toBeLessThan(0);
    expect(sunAt(18, T, settings).moon).toBe(-1);
    expect(sunAt(19, T, settings).moon).toBe(0);
    expect(sunAt(20, T, settings).moon).toBeCloseTo(0.1);
    expect(sunAt(0, T, settings).moon).toBeCloseTo(0.5);
  });

  it('follows the real moon phase', () => {
    // Full moon 3 January 2026, 10:03 UTC; new moon 18 January 2026, 19:52 UTC.
    expect(moonPhase(Date.UTC(2026, 0, 3, 10, 3))).toBeCloseTo(0.5, 1);
    const fresh = moonPhase(Date.UTC(2026, 0, 18, 19, 52));
    expect(Math.min(fresh, 1 - fresh)).toBeLessThan(0.02);
  });
});
