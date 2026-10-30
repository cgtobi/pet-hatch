export const DOJO: {
  baseWindow: number;
  widenFromMs: number;
  maxWindow: number;
  widenUntilMs: number;
  minPoints: number;
  rematchMs: number;
  offerAfterMs: number;
  answerMs: number;
  declinedMs: number;
  maxPlayers: number;
};

export interface Waiting {
  id: string;
  rating: number;
  joinedAt: number;
  /** The game can answer uneven offers. */
  offers?: boolean;
  /** An offer it's being asked about right now. */
  offer?: unknown;
}

/** The battle rating of a battle code, or null if it isn't a valid one. */
export function ratingFromCode(code: string): number | null;
/** How far from your own rating an opponent may be after waiting this long. */
export function matchWindow(rating: number, waitedMs: number): number;
/** Pairs among the waiting players: closest first, within both windows, no recent rematches. */
export function findPairs<T extends Waiting>(waiting: T[], now: number, recent: Map<string, number>): [T, T][];
/** Uneven offers: closest pairs among those that waited long enough, however far apart. */
export function findOffers<T extends Waiting>(
  waiting: T[],
  now: number,
  recent: Map<string, number>,
  declined: Map<string, number>,
  afterMs?: number,
): [T, T][];
export function pairKey(a: string, b: string): string;
