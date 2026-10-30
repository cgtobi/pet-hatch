/**
 * When the egg or pet will next need the player, for alerts on the phone (src/net/push.ts) while the game is
 * closed. The simulation plays on its own the same way every time (its chances come from the pet's seed and the
 * time), so running a copy ahead tells exactly when the next calls come, as long as nobody plays in between;
 * playing sends a new list anyway.
 */
import { HOUR, isAsleep, MINUTE } from './clock';
import { hoursUntilTurn } from './egg';
import { advance, gameNow, isReadyToHatch } from './game';
import type { EggState, GameState } from './types';

/** The pet calls (a real need or a tantrum: the alert doesn't tell), the egg needs care, or it's ready to hatch. */
export type AlertKind = 'call' | 'egg' | 'hatch';
/** [real time in ms, kind]. */
export type Alert = [number, AlertKind];

/** How far ahead to look. */
export const ALERT_HORIZON_H = 24;
/** At most this many alerts in a row without the player coming back: a forgotten game doesn't nag all day. */
export const MAX_ALERTS = 6;
/** At least this long between two alerts: as long as a call lasts. */
export const ALERT_GAP = 30 * MINUTE;
/** An egg need this low is about half an hour from becoming a care mistake (warmth drops fastest). */
const EGG_ALERT_LEVEL = 20;

function eggNeedsCare(egg: EggState, t: number): boolean {
  return Math.min(egg.warmth, egg.humidity, egg.bond) < EGG_ALERT_LEVEL || hoursUntilTurn(egg, t) <= 0.5;
}

/** What the player would be alerted to right now: the pet's open call (by when it started), egg care, hatching. */
function watch(s: GameState): { call: number | null; egg: boolean; hatch: boolean } {
  const pet = s.phase === 'hatched' && s.pet?.status === 'alive' ? s.pet : null;
  const egg = s.phase === 'egg' && !s.egg.failed;
  return {
    call: pet?.call?.at ?? null,
    egg: egg && eggNeedsCare(s.egg, s.simTime),
    hatch: isReadyToHatch(s),
  };
}

/**
 * The alerts for the next ALERT_HORIZON_H hours if the player doesn't come back, in real time. Something that
 * starts during the player's sleep window is saved for the morning; nothing is sent at night.
 */
export function predictAlerts(state: GameState, realNow: number): Alert[] {
  const sim = structuredClone(state);
  const start = gameNow(sim, realNow);
  advance(sim, start);
  const alerts: Alert[] = [];
  let was = watch(sim);
  let pending: AlertKind | null = null;
  for (let t = start + MINUTE; t <= start + ALERT_HORIZON_H * HOUR && alerts.length < MAX_ALERTS; t += MINUTE) {
    advance(sim, t);
    const now = watch(sim);
    // A new call is one that wasn't open a minute ago, or one whose timer started over (it woke up to call).
    const kind: AlertKind | null =
      now.call !== null && now.call !== was.call ? 'call' : now.egg && !was.egg ? 'egg' : now.hatch && !was.hatch ? 'hatch' : null;
    was = now;
    pending = kind ?? pending;
    if (!pending || isAsleep(t, sim.settings)) continue;
    const at = t - sim.clockOffset;
    const last = alerts.at(-1);
    if (!last || at - last[0] >= ALERT_GAP) alerts.push([at, pending]);
    pending = null;
  }
  return alerts;
}
