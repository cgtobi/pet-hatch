/**
 * The species book: every species the player has discovered, across all their pets. A species is "raised" once one
 * of the player's own pets took that form, and "seen" once their pet met it in battle. The book remembers which
 * discoveries the player has already looked at, so new ones can be pointed out.
 */
import type { ElementType, FormId, GameState } from './types';

export const BOOK_TYPES: ElementType[] = ['ember', 'tide', 'bloom', 'astral'];
export const BOOK_FORMS: FormId[] = [
  'baby',
  'child.bright',
  'child.scruffy',
  'teen.physical',
  'teen.technical',
  'adult.power',
  'adult.speed',
  'adult.guard',
  'adult.wits',
];
/** One entry per element and form: 36 in all. */
export type SpeciesKey = `${ElementType}.${FormId}`;
export const ALL_SPECIES: SpeciesKey[] = BOOK_TYPES.flatMap((t) => BOOK_FORMS.map((f) => `${t}.${f}` as SpeciesKey));

export const speciesKey = (type: ElementType, form: FormId): SpeciesKey => `${type}.${form}`;
export const isSpeciesKey = (k: unknown): k is SpeciesKey => typeof k === 'string' && ALL_SPECIES.includes(k as SpeciesKey);

export interface Book {
  /** Forms the player's earlier pets took (the current pet's come from its own path). */
  raised: SpeciesKey[];
  /** Species met in battle. */
  seen: SpeciesKey[];
  /** Discoveries the player has already looked at in the book. */
  shown: SpeciesKey[];
}

const add = (list: SpeciesKey[], key: SpeciesKey): boolean => !list.includes(key) && (list.push(key), true);

/** The book, made on first use; older saves start with what the family list remembers (each pet was a baby once). */
export function bookOf(state: GameState): Book {
  if (!state.book) {
    const raised: SpeciesKey[] = [];
    for (const a of state.family) {
      add(raised, speciesKey(a.type, 'baby'));
      add(raised, speciesKey(a.type, a.form));
    }
    state.book = { raised, seen: [], shown: [] };
  }
  return state.book;
}

/** Every species the player raised, the current pet's forms included. */
export function raisedSpecies(state: GameState): Set<SpeciesKey> {
  const raised = new Set(bookOf(state).raised);
  const pet = state.pet;
  if (pet) for (const form of pet.path) raised.add(speciesKey(pet.type, form));
  return raised;
}

/** Discovered: raised or seen. */
export function discoveredSpecies(state: GameState): Set<SpeciesKey> {
  return new Set([...raisedSpecies(state), ...bookOf(state).seen]);
}

/** A pet's forms go into the book for good when its story ends. */
export function rememberRaised(state: GameState, type: ElementType, path: FormId[]): void {
  const book = bookOf(state);
  for (const form of path) add(book.raised, speciesKey(type, form));
}

/** The pet met this species in battle; true if it's a new discovery. */
export function noteSeen(state: GameState, type: ElementType, form: FormId): boolean {
  const key = speciesKey(type, form);
  const isNew = !discoveredSpecies(state).has(key);
  add(bookOf(state).seen, key);
  return isNew;
}

/** Discoveries the player hasn't looked at in the book yet. */
export function newInBook(state: GameState): SpeciesKey[] {
  const shown = new Set(bookOf(state).shown);
  return [...discoveredSpecies(state)].filter((k) => !shown.has(k));
}

/** The player opened the book: everything discovered so far has been seen there. */
export function markBookShown(state: GameState): void {
  bookOf(state).shown = [...discoveredSpecies(state)];
}
