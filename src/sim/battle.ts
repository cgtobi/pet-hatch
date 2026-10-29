import { speciesName } from './evolution';
import { mulberry32 } from './rng';
import { STAT_CAPS, STATS } from './training';
import type { ElementType, FormId, PetState, Stat } from './types';

/**
 * Everything a battle needs to know about one side. Built from your pet, a wild creature or a friend's
 * share code, so battles never touch the live pet until the result is applied.
 */
export interface Fighter {
  name: string;
  type: ElementType;
  form: FormId;
  /** Life stage index, 1 (child) … 4 (elder). */
  stage: number;
  stats: Record<Stat, number>;
  discipline: number;
  /** The teen form it went through, which decides one move. */
  teen: 'teen.physical' | 'teen.technical' | null;
  seed: number;
  wild: boolean;
}

export type MoveId = 'tackle' | 'element' | 'rush' | 'focus' | 'crush' | 'flurry' | 'shell' | 'trick';

export interface Move {
  power: number;
  accuracy: number;
  /** Uses the attacker's element, so the type triangle applies. */
  typed: boolean;
  hits?: number;
  /** Always acts before a move without this. */
  first?: boolean;
  effect?: 'focus' | 'shell' | 'daze';
}

export const MOVES: Record<MoveId, Move> = {
  tackle: { power: 35, accuracy: 100, typed: false },
  element: { power: 45, accuracy: 95, typed: true },
  rush: { power: 60, accuracy: 85, typed: false },
  focus: { power: 0, accuracy: 100, typed: false, effect: 'focus' },
  crush: { power: 80, accuracy: 80, typed: true },
  flurry: { power: 18, accuracy: 95, typed: false, hits: 3, first: true },
  shell: { power: 0, accuracy: 100, typed: false, effect: 'shell' },
  trick: { power: 40, accuracy: 95, typed: true, effect: 'daze' },
};

const ADULT_MOVE: Record<Stat, MoveId> = { power: 'crush', speed: 'flurry', guard: 'shell', wits: 'trick' };
/** Each element beats the next one: Tide › Ember › Bloom › Tide. Astral has no strength or weakness. */
const BEATS: Partial<Record<ElementType, ElementType>> = { tide: 'ember', ember: 'bloom', bloom: 'tide' };
export const STRONG = 1.5;
export const WEAK = 0.67;
/** Discipline at which a pet always obeys; below it, up to this chance of ignoring an order. */
const OBEY_DISCIPLINE = 50;
const MAX_DISOBEY = 0.4;
const FOCUS_HEAL = 0.2;
const SHELL_HEAL = 0.15;
const MAX_GUARD_UP = 2;
const DAZE_CHANCE = 0.5;
/** A battle that drags on this long ends with both sides walking away. */
export const MAX_TURNS = 40;

export const BATTLE_ENERGY = 25;
const BATTLE_HUNGER = 8;
const WIN_REWARD = 2;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function typeFactor(attacker: ElementType, defender: ElementType): number {
  if (BEATS[attacker] === defender) return STRONG;
  if (BEATS[defender] === attacker) return WEAK;
  return 1;
}

/** Child: 2 moves, teen: 3 (by teen form), adult: 4 (by adult form). */
export function movesFor(f: Fighter): MoveId[] {
  const moves: MoveId[] = ['tackle', 'element'];
  if (f.stage >= 2) {
    const s = f.stats;
    const teen = f.teen ?? (s.power + s.speed >= s.guard + s.wits ? 'teen.physical' : 'teen.technical');
    moves.push(teen === 'teen.physical' ? 'rush' : 'focus');
  }
  if (f.stage >= 3 && f.form.startsWith('adult.')) moves.push(ADULT_MOVE[f.form.slice('adult.'.length) as Stat]);
  return moves;
}

export function maxHp(f: Fighter): number {
  return 60 + 15 * Math.min(f.stage, 3) + f.stats.guard;
}

export function fighterFromPet(pet: PetState): Fighter {
  const teen = pet.path.find((f) => f.startsWith('teen.')) ?? (pet.form.startsWith('teen.') ? pet.form : null);
  return {
    name: pet.name,
    type: pet.type,
    form: pet.form,
    stage: Math.min(pet.stage, 4),
    stats: { ...pet.stats },
    discipline: Math.round(pet.discipline),
    teen: teen as Fighter['teen'],
    seed: pet.seed,
    wild: false,
  };
}

/** A wild creature roughly as strong as your pet (a little weaker or stronger), at the same life stage. */
export function wildFoe(pet: Pick<PetState, 'stage' | 'stats'>, seed: number): Fighter {
  const r = mulberry32(seed);
  const type: ElementType = r() < 0.06 ? 'astral' : (['ember', 'tide', 'bloom'] as const)[Math.floor(r() * 3)];
  const stage = clamp(pet.stage, 1, 3);
  const own = STATS.reduce((sum, s) => sum + pet.stats[s], 0);
  // Even an untrained pet meets foes with a few points, so early battles aren't all zeros.
  const total = Math.max(own, [0, 10, 40, 100][stage]) * (0.75 + r() * 0.4);
  const weights = STATS.map(() => 0.3 + r());
  const sum = weights.reduce((a, b) => a + b, 0);
  const stats = Object.fromEntries(
    STATS.map((s, i) => [s, clamp(Math.round((total * weights[i]) / sum), 0, STAT_CAPS[stage])]),
  ) as Record<Stat, number>;
  const physical = stats.power + stats.speed >= stats.guard + stats.wits;
  const best = STATS.reduce((a, b) => (stats[b] > stats[a] ? b : a));
  const form: FormId =
    stage === 1
      ? r() < 0.5
        ? 'child.bright'
        : 'child.scruffy'
      : stage === 2
        ? physical
          ? 'teen.physical'
          : 'teen.technical'
        : `adult.${best}`;
  return {
    name: speciesName(type, form),
    type,
    form,
    stage,
    stats,
    discipline: 100,
    teen: stage >= 2 ? (physical ? 'teen.physical' : 'teen.technical') : null,
    seed,
    wild: true,
  };
}

// ---------- the battle itself ----------

export type SideKey = 'a' | 'b';

export interface Side {
  f: Fighter;
  moves: MoveId[];
  maxHp: number;
  hp: number;
  /** Next damaging move hits 1.5× harder. */
  focus: boolean;
  guardUp: number;
  dazed: boolean;
}

/** Side a is the player; side b is always played by the computer. */
export interface Battle {
  a: Side;
  b: Side;
  turn: number;
  winner: SideKey | null;
  rand: () => number;
}

export type BattleEvent =
  | { kind: 'use'; side: SideKey; move: MoveId }
  /** Disobeyed and did nothing. */
  | { kind: 'ignore'; side: SideKey }
  /** Disobeyed and picked its own move (a 'use' follows). */
  | { kind: 'wild'; side: SideKey }
  | { kind: 'skip'; side: SideKey }
  | { kind: 'miss'; side: SideKey }
  | { kind: 'hit'; side: SideKey; target: SideKey; damage: number; factor: number; crit: boolean; hp: number }
  | { kind: 'hits'; side: SideKey; n: number }
  | { kind: 'heal'; side: SideKey; amount: number; hp: number }
  | { kind: 'focus'; side: SideKey }
  | { kind: 'guard'; side: SideKey }
  | { kind: 'dazed'; side: SideKey }
  | { kind: 'faint'; side: SideKey };

function side(f: Fighter): Side {
  const hp = maxHp(f);
  return { f, moves: movesFor(f), maxHp: hp, hp, focus: false, guardUp: 0, dazed: false };
}

export function createBattle(player: Fighter, foe: Fighter, seed: number): Battle {
  return { a: side(player), b: side(foe), turn: 0, winner: null, rand: mulberry32(seed) };
}

const other = (k: SideKey): SideKey => (k === 'a' ? 'b' : 'a');

export function disobeyChance(f: Fighter): number {
  return MAX_DISOBEY * clamp(1 - f.discipline / OBEY_DISCIPLINE, 0, 1);
}

/** The computer's choice: heal when low, set up a daze or focus now and then, else the hardest-hitting move. */
export function aiMove(b: Battle, key: SideKey): MoveId {
  const s = b[key];
  const t = b[other(key)];
  const r = b.rand;
  const heal = s.moves.find((m) => m === 'focus' || m === 'shell');
  if (heal && s.hp < s.maxHp * 0.4 && r() < 0.6 && !(heal === 'shell' && s.guardUp >= MAX_GUARD_UP)) return heal;
  if (s.moves.includes('trick') && !t.dazed && r() < 0.3) return 'trick';
  if (s.moves.includes('focus') && !s.focus && s.hp > s.maxHp * 0.6 && r() < 0.2) return 'focus';
  const attacks = s.moves.filter((m) => MOVES[m].power > 0);
  if (r() < 0.25) return attacks[Math.floor(r() * attacks.length)];
  const value = (m: MoveId) => {
    const mv = MOVES[m];
    return mv.power * (mv.accuracy / 100) * (mv.hits ?? 1) * (mv.typed ? typeFactor(s.f.type, t.f.type) : 1);
  };
  return attacks.reduce((best, m) => (value(m) > value(best) ? m : best));
}

/** Play one round: both sides act (faster first), and the events describe what happened, in order. */
export function playTurn(b: Battle, playerMove: MoveId): BattleEvent[] {
  if (b.winner) return [];
  const events: BattleEvent[] = [];
  const chosen: Record<SideKey, MoveId> = { a: playerMove, b: aiMove(b, 'b') };
  const fa = !!MOVES[chosen.a].first;
  const fb = !!MOVES[chosen.b].first;
  const sa = b.a.f.stats.speed;
  const sb = b.b.f.stats.speed;
  const aFirst = fa !== fb ? fa : sa !== sb ? sa > sb : b.rand() < 0.5;
  for (const key of aFirst ? (['a', 'b'] as const) : (['b', 'a'] as const)) {
    if (b.winner) break;
    act(b, key, chosen[key], events);
  }
  b.turn++;
  return events;
}

function act(b: Battle, key: SideKey, move: MoveId, events: BattleEvent[]): void {
  const s = b[key];
  const tk = other(key);
  const t = b[tk];
  const r = b.rand;
  if (s.dazed) {
    s.dazed = false;
    events.push({ kind: 'skip', side: key });
    return;
  }
  if (r() < disobeyChance(s.f)) {
    if (r() < 0.5 || s.moves.length < 2) {
      events.push({ kind: 'ignore', side: key });
      return;
    }
    const others = s.moves.filter((m) => m !== move);
    move = others[Math.floor(r() * others.length)];
    events.push({ kind: 'wild', side: key });
  }
  events.push({ kind: 'use', side: key, move });
  const m = MOVES[move];
  const heal = (fraction: number) => {
    const amount = Math.min(s.maxHp - s.hp, Math.round(s.maxHp * fraction));
    s.hp += amount;
    events.push({ kind: 'heal', side: key, amount, hp: s.hp });
  };
  if (m.effect === 'focus') {
    s.focus = true;
    events.push({ kind: 'focus', side: key });
    heal(FOCUS_HEAL);
    return;
  }
  if (m.effect === 'shell') {
    s.guardUp = Math.min(MAX_GUARD_UP, s.guardUp + 1);
    events.push({ kind: 'guard', side: key });
    heal(SHELL_HEAL);
    return;
  }

  const atk = 10 + s.f.stats.power;
  const def = (10 + t.f.stats.guard) * (1 + 0.4 * t.guardUp);
  const dodge = clamp((t.f.stats.speed - s.f.stats.speed) / 300, 0, 0.15);
  const factor = m.typed ? typeFactor(s.f.type, t.f.type) : 1;
  const hits = m.hits ?? 1;
  let landed = 0;
  for (let i = 0; i < hits && t.hp > 0; i++) {
    if (r() >= (m.accuracy / 100) * (1 - dodge)) {
      if (hits === 1) events.push({ kind: 'miss', side: key });
      continue;
    }
    const crit = r() < 0.05 + s.f.stats.wits / 500;
    const raw = m.power * (atk / (atk + def)) * 1.1 * factor * (crit ? 1.5 : 1) * (s.focus ? 1.5 : 1) * (0.85 + 0.15 * r());
    const damage = Math.min(t.hp, Math.max(1, Math.round(raw)));
    t.hp -= damage;
    landed++;
    events.push({ kind: 'hit', side: key, target: tk, damage, factor, crit, hp: t.hp });
  }
  if (hits > 1) events.push(landed ? { kind: 'hits', side: key, n: landed } : { kind: 'miss', side: key });
  s.focus = false;
  if (m.effect === 'daze' && landed && t.hp > 0 && r() < DAZE_CHANCE) {
    t.dazed = true;
    events.push({ kind: 'dazed', side: tk });
  }
  if (t.hp <= 0) {
    events.push({ kind: 'faint', side: tk });
    b.winner = key;
  }
}

// ---------- after the battle ----------

export type Outcome = 'won' | 'lost' | 'fled';

export interface BattleReward {
  stat: Stat | null;
  gain: number;
}

/** Apply a finished battle to the real pet: tiredness, mood, record, and a small stat gain for a win. */
export function finishBattle(pet: PetState, outcome: Outcome, seed: number): BattleReward {
  pet.energy = clamp(pet.energy - BATTLE_ENERGY, 0, 100);
  pet.hunger = clamp(pet.hunger - BATTLE_HUNGER, 0, 100);
  if (outcome === 'fled') {
    pet.mood = clamp(pet.mood - 3, 0, 100);
    return { stat: null, gain: 0 };
  }
  if (outcome === 'lost') {
    pet.battles.losses++;
    pet.mood = clamp(pet.mood - 8, 0, 100);
    return { stat: null, gain: 0 };
  }
  pet.battles.wins++;
  pet.mood = clamp(pet.mood + 10, 0, 100);
  const cap = STAT_CAPS[Math.min(pet.stage, STAT_CAPS.length - 1)];
  const open = STATS.filter((s) => pet.stats[s] < cap);
  if (!open.length) return { stat: null, gain: 0 };
  const stat = open[Math.floor(mulberry32(seed)() * open.length)];
  const gain = Math.min(WIN_REWARD, cap - pet.stats[stat]);
  pet.stats[stat] += gain;
  return { stat, gain };
}
