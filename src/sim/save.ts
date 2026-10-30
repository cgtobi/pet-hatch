import { LANGUAGES } from '../i18n';
import { migrateEggCare } from './egg';
import { DEFAULT_SETTINGS, NEGLECT_MODES } from './game';
import { LIFE_STAGES, migratePet } from './pet';
import { STATS } from './training';
import type { Dropping, ElementType, FormId, GameState, Heritage, PetState, PetStatus, Stat } from './types';

const KEY = 'pethatch.save';

export function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseSave(raw) : null;
  } catch {
    return null;
  }
}

export function saveGame(state: GameState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked (private mode): the game keeps running, it just won't persist.
  }
}


/** A copy-pasteable backup code. */
export function exportSave(state: GameState): string {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function importSave(code: string): GameState {
  const bin = atob(code.trim());
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const state = parseSave(new TextDecoder().decode(bytes));
  // A save code can come from anywhere (a forum, a friend), so everything in it must be what the game writes.
  if (!state || !isSound(state)) throw new Error('That save code is not valid.');
  return state;
}

const TYPES: ElementType[] = ['ember', 'tide', 'bloom', 'astral'];
const FORMS: FormId[] = [
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
const STATUSES: PetStatus[] = ['alive', 'ranAway', 'died', 'retired'];
const ENDINGS = ['retired', 'ranAway', 'died', 'released'];
/** Names are typed (14 characters) or come with battle codes (at most 56 bytes). */
const MAX_NAME = 60;

const isNum = (v: unknown, lo = -Infinity, hi = Infinity): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const isInt = (v: unknown, lo: number, hi: number) => isNum(v, lo, hi) && Number.isInteger(v);
const isName = (v: unknown) => typeof v === 'string' && v.length <= MAX_NAME;
const isOneOf = <T>(v: unknown, list: readonly T[]) => list.includes(v as T);
const isList = (v: unknown, max: number, item: (x: never) => boolean) =>
  Array.isArray(v) && v.length <= max && v.every((x) => item(x as never));
const isStats = (v: unknown, max: number) =>
  typeof v === 'object' && v !== null && Object.entries(v).every(([k, n]) => isOneOf(k, STATS) && isNum(n, 0, max));

/**
 * Whether an imported save (after upgrading) holds only what the game itself writes: the right types, ranges
 * and names, so nothing in it can end up as markup on screen or break the game on its next start.
 */
export function isSound(s: GameState): boolean {
  const { settings: o, egg, pet } = s;
  const settings =
    isOneOf(o.neglect, NEGLECT_MODES) &&
    isInt(o.sleepStart, 0, 23) &&
    isInt(o.sleepEnd, 0, 23) &&
    [o.sound, o.music, o.haptics].every((b) => typeof b === 'boolean') &&
    isOneOf(o.language, ['auto', ...LANGUAGES]) &&
    (o.shareStats === undefined || typeof o.shareStats === 'boolean') &&
    (o.alerts === undefined || typeof o.alerts === 'boolean');
  const game = isNum(s.simTime) && isNum(s.clockOffset) && (s.phase === 'egg' || pet !== null);
  const family = isList(s.family, 10_000, (a: GameState['family'][number]) =>
    isName(a.name) &&
    isOneOf(a.type, TYPES) &&
    isOneOf(a.form, FORMS) &&
    isInt(a.generation, 1, 1e6) &&
    isOneOf(a.ending, ENDINGS) &&
    isInt(a.wins, 0, 1e6) &&
    (a.stars === undefined || isInt(a.stars, 0, STATS.length)) &&
    isNum(a.hatchedAt) &&
    isNum(a.endedAt),
  );
  const h = egg.heritage;
  const eggOk =
    [egg.warmth, egg.humidity, egg.bond, egg.health].every((n) => isNum(n, -1, 101)) &&
    [egg.devHours, egg.baseHours, egg.laidAt, egg.lastTurnedAt].every((n) => isNum(n)) &&
    isInt(egg.seed, 0, 2 ** 32) &&
    (h === null ||
      (isName(h.parentName) && isOneOf(h.parentType, TYPES) && isStats(h.stats, 100) && isInt(h.generation, 1, 1e6)));
  const petOk =
    pet === null ||
    (isName(pet.name) &&
      isOneOf(pet.type, TYPES) &&
      isOneOf(pet.status, STATUSES) &&
      isInt(pet.seed, 0, 2 ** 32) &&
      [pet.hunger, pet.mood, pet.energy, pet.health, pet.discipline].every((n) => isNum(n, -1, 1000)) &&
      isInt(pet.stage, 0, LIFE_STAGES.length - 1) &&
      isInt(pet.shownStage, 0, LIFE_STAGES.length - 1) &&
      isOneOf(pet.form, FORMS) &&
      isOneOf(pet.shownForm, FORMS) &&
      isList(pet.path, FORMS.length, (f: FormId) => isOneOf(f, FORMS)) &&
      isStats(pet.stats, 100) &&
      isNum(pet.endurance, 0, 100) &&
      isInt(pet.battles?.wins, 0, 1e6) &&
      isInt(pet.battles?.losses, 0, 1e6) &&
      (pet.battles.champions === undefined || isInt(pet.battles.champions, 0, 1e6)) &&
      (pet.wildHeat === undefined || isInt(pet.wildHeat, -10, 10)) &&
      isInt(pet.generation, 1, 1e6) &&
      isInt(pet.trainings, 0, 1e7) &&
      isNum(pet.battleXp, 0, 1000) &&
      isList(pet.lessons, 100, (l: PetState['lessons'][number]) => isOneOf(l.stat, STATS) && isName(l.from)) &&
      isList(pet.droppings, 100, (d: Dropping) => isNum(d.angle) && isNum(d.dist, 0, 10) && isNum(d.at)) &&
      isList(pet.mistakes, LIFE_STAGES.length, (n: number) => isInt(n, 0, 1e6)));
  return settings && game && family && eggOk && petOk;
}

function parseSave(json: string): GameState | null {
  const s = JSON.parse(json) as GameState;
  const ok =
    s &&
    s.version === 1 &&
    (s.phase === 'egg' || s.phase === 'hatched') &&
    typeof s.simTime === 'number' &&
    typeof s.egg?.baseHours === 'number' &&
    typeof s.settings?.neglect === 'string';
  if (!ok) return null;
  // Fill in settings added after the save was written.
  s.settings = { ...DEFAULT_SETTINGS, ...s.settings };
  s.family ??= [];
  s.egg.heritage ??= null;
  // Before mastered stats, an egg inherited one stat.
  const h = s.egg.heritage as (Heritage & { stat?: Stat; bonus?: number }) | null;
  if (h && !h.stats) {
    h.stats = { [h.stat!]: h.bonus };
    delete h.stat;
    delete h.bonus;
  }
  migrateEggCare(s.egg);
  if (s.pet) s.pet = migratePet(s.pet);
  return s;
}
