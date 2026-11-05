/**
 * Dojo matchmaking: who is waiting, how strong their pet is, and which two should fight.
 * Pure functions, used by the relay and tested on their own.
 */

/** Stat limits by life stage (child … elder), as in the game. */
const STAT_CAPS = [0, 30, 60, 100, 100];

export const DOJO = {
  /** Opponents within this share of your rating at first… */
  baseWindow: 0.1,
  /** …widening steadily from this long into the wait… */
  widenFromMs: 10_000,
  /** …until it reaches this share, this long in (when uneven offers start too). */
  maxWindow: 0.35,
  widenUntilMs: 40_000,
  /** Never narrower than this many rating points, so beginners still find each other. */
  minPoints: 8,
  /** The same two pets aren't matched again within this time. */
  rematchMs: 2 * 60_000,
  /**
   * With nobody close in strength, two pets that have both waited this long are offered to each other however
   * far apart they are; both must say yes within answerMs. A pair that said no isn't offered again for declinedMs.
   */
  offerAfterMs: 40_000,
  answerMs: 20_000,
  declinedMs: 10 * 60_000,
  maxPlayers: 500,
};

function checksum(bytes) {
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193);
  return (h ^ (h >>> 8) ^ (h >>> 16) ^ (h >>> 24)) & 0xff;
}

/**
 * The battle rating of a battle code, or null if it isn't a valid one. Mirrors the game's battle-code reader
 * and battleRating() (kept in step by a test), so a player can't claim a weaker pet than the one they fight with.
 */
export function ratingFromCode(code) {
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{16,120}$/.test(code)) return null;
  const bytes = Buffer.from(code.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (bytes.length < 12) return null;
  const body = bytes.subarray(0, bytes.length - 1);
  if (checksum(body) !== bytes[bytes.length - 1] || body[0] !== 1) return null;
  const stage = (body[1] >> 3) & 7;
  if (stage < 1 || stage > 4) return null;
  const stats = [body[3], body[4], body[5], body[6]];
  if (stats.some((s) => s > STAT_CAPS[stage])) return null;
  return stats.reduce((a, b) => a + b, 0) + 20 * Math.min(stage, 3);
}

/** How far from your own rating an opponent may be after waiting this long. */
export function matchWindow(rating, waitedMs) {
  const progress = Math.max(0, Math.min(1, (waitedMs - DOJO.widenFromMs) / (DOJO.widenUntilMs - DOJO.widenFromMs)));
  const share = DOJO.baseWindow + (DOJO.maxWindow - DOJO.baseWindow) * progress;
  return Math.max(DOJO.minPoints, rating * share);
}

/**
 * Pick pairs among the waiting players: closest ratings first, each within both players' current windows,
 * skipping pairs that fought each other recently. Each player is in at most one pair.
 * @param {{ id: string, rating: number, joinedAt: number }[]} waiting
 * @param {number} now
 * @param {Map<string, number>} recent  pair key → when they were last matched
 */
export function findPairs(waiting, now, recent) {
  const candidates = [];
  for (let i = 0; i < waiting.length; i++) {
    for (let j = i + 1; j < waiting.length; j++) {
      const a = waiting[i];
      const b = waiting[j];
      if (a.id === b.id) continue;
      const diff = Math.abs(a.rating - b.rating);
      const allowed = Math.min(matchWindow(a.rating, now - a.joinedAt), matchWindow(b.rating, now - b.joinedAt));
      if (diff > allowed) continue;
      if (now - (recent.get(pairKey(a.id, b.id)) ?? -Infinity) < DOJO.rematchMs) continue;
      candidates.push({ a, b, diff });
    }
  }
  return takeClosest(candidates);
}

/**
 * Uneven offers: among players that take offers, aren't in one already and have waited at least `afterMs`, the
 * closest pairs, however far apart (normal matching already had its chance). Skips recent rematches and pairs
 * that turned each other down lately.
 * @param {{ id: string, rating: number, joinedAt: number, offers?: boolean, offer?: unknown }[]} waiting
 * @param {number} now
 * @param {Map<string, number>} recent  pair key → when they were last matched
 * @param {Map<string, number>} declined  pair key → when one of them said no
 */
export function findOffers(waiting, now, recent, declined, afterMs = DOJO.offerAfterMs) {
  const ready = waiting.filter((w) => w.offers && !w.offer && now - w.joinedAt >= afterMs);
  const candidates = [];
  for (let i = 0; i < ready.length; i++) {
    for (let j = i + 1; j < ready.length; j++) {
      const a = ready[i];
      const b = ready[j];
      if (a.id === b.id) continue;
      const key = pairKey(a.id, b.id);
      if (now - (recent.get(key) ?? -Infinity) < DOJO.rematchMs) continue;
      if (now - (declined.get(key) ?? -Infinity) < DOJO.declinedMs) continue;
      candidates.push({ a, b, diff: Math.abs(a.rating - b.rating) });
    }
  }
  return takeClosest(candidates);
}

/**
 * Closest first, each player in at most one pair.
 * @template T @param {{ a: T, b: T, diff: number }[]} candidates @returns {[T, T][]}
 */
function takeClosest(candidates) {
  candidates.sort((x, y) => x.diff - y.diff);
  const used = new Set();
  const pairs = [];
  for (const { a, b } of candidates) {
    if (used.has(a) || used.has(b)) continue;
    used.add(a);
    used.add(b);
    pairs.push(/** @type {[T, T]} */ ([a, b]));
  }
  return pairs;
}

export const pairKey = (x, y) => (x < y ? `${x}|${y}` : `${y}|${x}`);

/**
 * Ghosts: pets that visited the dojo, kept without their names, step in when nobody else is around. The game
 * plays them on the player's own device (like a friend's battle code), and each result goes back to the pet's
 * owner as a tally, which only the owner's game can fetch (with its secret key; the relay keeps only a hash).
 */
export const GHOSTS = {
  /** A player who has waited this long without a match meets a ghost. */
  afterMs: 20_000,
  /** Ghosts are kept this long after their pet's last visit, and at most this many (the oldest go first). */
  keepMs: 7 * 24 * 60 * 60_000,
  maxPool: 300,
  /** The same player doesn't meet the same ghost again within this time. */
  againMs: 10 * 60_000,
  /** A ghost battle's result is taken back within this time, once. */
  ticketMs: 15 * 60_000,
  /** Owners' tallies wait this long to be fetched, and at most this many. */
  tallyKeepMs: 30 * 24 * 60 * 60_000,
  maxTallies: 5000,
};

/**
 * The same pet's battle code without its name (a space, which the game shows as the species), or null if it isn't
 * a valid code. Ghosts only ever carry this, so a name a child typed never reaches anyone else.
 */
export function namelessCode(code) {
  if (ratingFromCode(code) === null) return null;
  const bytes = Buffer.from(code.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const body = Buffer.concat([bytes.subarray(0, 10), Buffer.from([0x20])]);
  const all = Buffer.concat([body, Buffer.from([checksum(body)])]);
  return all.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The ghost a waiting player meets: the closest in strength within the dojo's widest window, never the player's own
 * pet, and not one they met lately. Null if none fits.
 * @param {{ id: string, rating: number, owner: string | null, self?: string }} player  self: its own ghost's key
 * @param {{ key: string, code: string, rating: number, owner: string | null }[]} pool
 * @param {Map<string, number>} met  player id|ghost key → when they last met
 */
export function pickGhost(player, pool, now, met) {
  const allowed = Math.max(DOJO.minPoints, player.rating * DOJO.maxWindow);
  let best = null;
  for (const g of pool) {
    if ((player.owner && g.owner === player.owner) || g.key === player.self) continue;
    const diff = Math.abs(g.rating - player.rating);
    if (diff > allowed) continue;
    if (now - (met.get(`${player.id}|${g.key}`) ?? -Infinity) < GHOSTS.againMs) continue;
    if (!best || diff < best.diff) best = { g, diff };
  }
  return best?.g ?? null;
}
