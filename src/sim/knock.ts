/**
 * Knock back: from the Wobbly stage on, the egg now and then knocks from inside while the game is open. Tapping
 * the same rhythm back on the egg pleases it and brings the hatch a little closer. Missing it costs nothing.
 */

/** Seconds between knocks: a short and a long gap, so each pattern has a rhythm to copy. */
const SHORT = 0.3;
const LONG = 0.6;
/** A tap gap still matches if it is within this share of the knock's gap (and at least MIN_SLACK seconds). */
const SLACK = 0.45;
const MIN_SLACK = 0.15;
/** The egg knocks from this stage on (Wobbly). */
export const KNOCK_STAGE = 2;
/** Seconds after the last knock to start answering, and after the last tap before the answer counts as done. */
export const ANSWER_WAIT = 3.5;
export const ANSWER_GAP = 1.4;
/** Seconds until the first knock of a visit, and between knocks after that. */
export const FIRST_KNOCK = [12, 25] as const;
export const NEXT_KNOCK = [40, 80] as const;
/** An answered knock brings the hatch this much closer (5 minutes). */
export const KNOCK_HOURS = 5 / 60;

/** Times of the knocks from the first one: 2–4 knocks with short and long gaps. */
export function knockPattern(rand: () => number): number[] {
  const count = 2 + Math.floor(rand() * 3);
  const times = [0];
  for (let i = 1; i < count; i++) times.push(times[i - 1] + (rand() < 0.5 ? SHORT : LONG));
  return times;
}

/** Whether the taps (their times, in seconds) copy the knocks: as many, with roughly the same gaps. */
export function matchesKnock(knocks: number[], taps: number[]): boolean {
  if (taps.length !== knocks.length) return false;
  for (let i = 1; i < knocks.length; i++) {
    const want = knocks[i] - knocks[i - 1];
    const got = taps[i] - taps[i - 1];
    if (Math.abs(got - want) > Math.max(MIN_SLACK, SLACK * want)) return false;
  }
  return true;
}

/** Seconds until the next knock, between `range[0]` and `range[1]`. */
export function knockDelay(range: readonly [number, number], rand: () => number): number {
  return range[0] + rand() * (range[1] - range[0]);
}
