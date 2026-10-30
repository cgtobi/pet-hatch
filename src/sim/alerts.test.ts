import { describe, expect, it } from 'vitest';
import { ALERT_GAP, MAX_ALERTS, predictAlerts } from './alerts';
import { HOUR, MINUTE } from './clock';
import { advance, DEFAULT_SETTINGS, hatch, newGame } from './game';
import type { GameState } from './types';

// Local-time timestamps, so the sleep window (22:00–07:00) is deterministic.
const at = (day: number, hour: number, minute = 0) => new Date(2026, 0, day, hour, minute).getTime();

function petGame(start = at(1, 9)): GameState {
  const state = newGame(start, DEFAULT_SETTINGS, 42);
  const pet = hatch(state, start, false);
  pet.revealSeen = true;
  return state;
}

describe('alerts', () => {
  it('predicts the minute the pet starts calling', () => {
    const state = petGame();
    const [first] = predictAlerts(state, at(1, 9));
    expect(first[1]).toBe('call');
    expect(first[0]).toBeGreaterThan(at(1, 9));
    // Playing it out for real: no call a minute before, a call at that minute.
    const real = structuredClone(state);
    advance(real, first[0] - MINUTE);
    expect(real.pet!.call).toBeNull();
    advance(real, first[0]);
    expect(real.pet!.call).not.toBeNull();
  });

  it('doesn’t alert for a call that is already open', () => {
    const state = petGame();
    advance(state, predictAlerts(state, at(1, 9))[0][0]);
    const next = predictAlerts(state, state.simTime);
    expect(next[0][0]).toBeGreaterThan(state.simTime + 20 * MINUTE);
  });

  it('keeps the night quiet and alerts in the morning instead', () => {
    const state = petGame(at(1, 21));
    state.pet!.hunger = 22;
    for (const [t] of predictAlerts(state, at(1, 21, 30))) {
      const hour = new Date(t).getHours();
      expect(hour >= 7 && hour < 22).toBe(true);
    }
  });

  it('spaces alerts out and stops after a few unanswered ones', () => {
    const state = petGame();
    state.pet!.hunger = 0;
    state.pet!.mood = 0;
    const alerts = predictAlerts(state, at(1, 9));
    expect(alerts).toHaveLength(MAX_ALERTS);
    for (let i = 1; i < alerts.length; i++) expect(alerts[i][0] - alerts[i - 1][0]).toBeGreaterThanOrEqual(ALERT_GAP);
  });

  it('gives real times when the game clock runs ahead', () => {
    const state = petGame();
    const plain = predictAlerts(state, at(1, 9));
    // The same game moment, with the game's clock two hours ahead of the real one: two real hours earlier.
    const ahead = structuredClone(state);
    ahead.clockOffset = 2 * HOUR;
    expect(predictAlerts(ahead, at(1, 9) - 2 * HOUR)).toEqual(plain.map(([t, kind]) => [t - 2 * HOUR, kind]));
  });

  it('alerts when the egg needs care, and when it is ready to hatch', () => {
    const state = newGame(at(1, 9), DEFAULT_SETTINGS, 42);
    expect(predictAlerts(state, at(1, 9))[0][1]).toBe('egg');
    state.egg.devHours = state.egg.baseHours - 0.5;
    state.egg.warmth = state.egg.humidity = state.egg.bond = 100;
    state.egg.lastTurnedAt = at(1, 9);
    const hatchAlert = predictAlerts(state, at(1, 9)).find(([, kind]) => kind === 'hatch');
    expect(hatchAlert).toBeDefined();
  });

  it('has nothing to say once the pet’s story ended', () => {
    const state = petGame();
    state.pet!.status = 'retired';
    expect(predictAlerts(state, at(1, 9))).toEqual([]);
  });
});
