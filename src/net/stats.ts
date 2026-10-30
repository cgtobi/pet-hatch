/**
 * Anonymous pet stats, only for players who opted in and only where the server collects them: a stats.json
 * next to the game ({ "url": "stats.php" }) says where to send them. Without it nothing is asked or sent.
 *
 * Each pet reports a small snapshot at most once a day while the game is open, and right away when something
 * changes (hatching, a new life stage, the end of its story). The pet is identified by a hash of its egg's seed
 * and laying time, which is new with every egg: no names, no save, nothing about the device or the player.
 */
import { hatchStage } from '../sim/egg';
import { masteredStats } from '../sim/training';
import type { ElementType, FormId, GameState, NeglectMode } from '../sim/types';

export type PetEnding = 'alive' | 'retired' | 'ranAway' | 'died' | 'lost' | 'released';

export interface PetSnapshot {
  pet: string;
  v: string;
  phase: 'egg' | 'pet';
  /** Visible egg stage (0–4) for an egg, life stage (0 baby … 4 elder) for a pet. */
  stage: number;
  type: ElementType | null;
  form: FormId | null;
  mode: NeglectMode;
  gen: number;
  status: PetEnding;
  stars: number;
}

/** 53-bit FNV-1a, as 14 hex digits: enough to tell pets apart, and it works without a secure context. */
export function petId(seed: number, laidAt: number): string {
  let h = 0xcbf29ce484222325n;
  for (const c of `${seed}:${laidAt}`) h = BigInt.asUintN(64, (h ^ BigInt(c.charCodeAt(0))) * 0x100000001b3n);
  return (h & 0x1fffffffffffffn).toString(16).padStart(14, '0');
}

/** What the server learns about the current egg or pet; `status` overrides it (e.g. 'released'). */
export function snapshot(state: GameState, version: string, status?: PetEnding): PetSnapshot {
  const { egg, pet } = state;
  const base = { pet: petId(egg.seed, egg.laidAt), v: version, mode: state.settings.neglect };
  if (state.phase === 'egg' || !pet) {
    return {
      ...base,
      phase: 'egg',
      stage: hatchStage(egg),
      type: null,
      form: null,
      gen: egg.heritage?.generation ?? 1,
      status: status ?? (egg.failed ? 'lost' : 'alive'),
      stars: 0,
    };
  }
  return {
    ...base,
    phase: 'pet',
    stage: pet.stage,
    type: pet.type,
    form: pet.form,
    gen: pet.generation,
    status: status ?? pet.status,
    stars: masteredStats(pet).length,
  };
}

/** The local calendar day, so "once a day" follows the player's day. */
export function today(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Whether this snapshot still needs sending: a new day, or anything changed since the last one. */
export function isDue(sent: GameState['statsSent'], snap: PetSnapshot, day: string): boolean {
  return !sent || sent.day !== day || sent.key !== JSON.stringify(snap);
}

/** Where stats go, if this server collects them. */
export async function findStats(): Promise<string | null> {
  try {
    const res = await fetch('./stats.json', { cache: 'no-store' });
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return null;
    const { url } = (await res.json()) as { url?: unknown };
    return typeof url === 'string' && url ? new URL(url, location.href).toString() : null;
  } catch {
    // Offline or no stats.json: nothing to send, nothing to ask.
    return null;
  }
}

/**
 * Send the snapshot if it is due and the player opted in; returns whether it went out. Uses a beacon, so a
 * report made just before the page reloads (a new egg) still arrives.
 */
export function report(url: string | null, state: GameState, version: string, status?: PetEnding): boolean {
  if (!url || state.settings.shareStats !== true) return false;
  const snap = snapshot(state, version, status);
  const day = today();
  if (!isDue(state.statsSent, snap, day)) return false;
  const body = JSON.stringify(snap);
  const sent = navigator.sendBeacon?.(url, new Blob([body], { type: 'text/plain' }));
  if (!sent) void fetch(url, { method: 'POST', body, keepalive: true }).catch(() => {});
  state.statsSent = { day, key: body };
  return true;
}
