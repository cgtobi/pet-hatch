import { speciesName } from './evolution';
import { mulberry32 } from './rng';
import { maxEnergy, STAT_CAPS, STATS } from './training';
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
/**
 * A win against another pet (not a wild creature) this much stronger, by battle rating, is an upset and earns double
 * the stat points.
 */
export const UPSET_SHARE = 1.35;

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

/**
 * Rough battle strength, for matching opponents in the dojo: all stats plus a bonus per life stage
 * (which brings health and moves). The relay computes the same number from the battle code.
 */
export function battleRating(f: Pick<Fighter, 'stage' | 'stats'>): number {
  return STATS.reduce((sum, s) => sum + f.stats[s], 0) + 20 * Math.min(f.stage, 3);
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

/** Side a is the player; side b is the computer, or a second player in a live battle. */
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

/**
 * Play one round: both sides act (faster first), and the events describe what happened, in order.
 * Without `moveB` the computer picks side b's move. Given the same battle and moves, every device
 * computes the same result, which is what live battles rely on.
 */
export function playTurn(b: Battle, moveA: MoveId, moveB?: MoveId): BattleEvent[] {
  if (b.winner) return [];
  const events: BattleEvent[] = [];
  const chosen: Record<SideKey, MoveId> = { a: moveA, b: moveB ?? aiMove(b, 'b') };
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

/** A short fingerprint of the battle state, compared between devices after each live turn. */
export function battleState(b: Battle): string {
  const side = (s: Side) => [s.hp, s.focus ? 1 : 0, s.guardUp, s.dazed ? 1 : 0].join(',');
  return `${b.turn}|${side(b.a)}|${side(b.b)}|${b.winner ?? '-'}`;
}

// ---------- after the battle ----------

export type Outcome = 'won' | 'lost' | 'fled';

/** Experience for a full bar, which turns into one stat point. */
export const XP_PER_POINT = 10;
const XP_WIN = 4;
const XP_LOSS = 2;
/** A loss only teaches something if the pet lasted this many turns… */
const LOSS_MIN_TURNS = 3;
/** …or took this share of the opponent's health. */
const LOSS_MIN_DAMAGE = 0.25;
/** A win by forfeit only counts once this many turns were played. */
const FORFEIT_MIN_TURNS = 2;
const MAX_LESSONS = 10;

/** What happened in a battle, from the pet's side, for the experience it earns. */
export interface BattleSummary {
  turns: number;
  /** How close the opponent came to fainting: 1 − its health left / its full health. */
  damageDealt: number;
  foe: Fighter;
  /** The other side left or gave up. */
  forfeit: boolean;
  /** This pet's player gave up. */
  gaveUp: boolean;
}

export interface BattleReward {
  /** The winner's instant stat gain. */
  stat: Stat | null;
  gain: number;
  /** Experience earned in this battle. */
  xp: number;
  /** A full experience bar trained this stat… */
  learned: Stat | null;
  /** …taught by this opponent (null when no lesson was waiting, so it went into a random stat). */
  teacher: string | null;
  /** Won against a much stronger pet (see UPSET_SHARE): the stat gain was doubled. */
  upset: boolean;
}

const total = (stats: Record<Stat, number>) => STATS.reduce((sum, s) => sum + stats[s], 0);

/**
 * Experience earned, before the bar. Hidden effort scaling: a loser earns more the closer the opponent came to
 * fainting; a winner earns more for beating a stronger opponent. Running away, giving up, quick losses and
 * early forfeits earn nothing, so losing on purpose doesn't pay.
 */
export function battleXp(pet: PetState, outcome: Outcome, s: BattleSummary): number {
  if (outcome === 'fled' || s.gaveUp) return 0;
  if (outcome === 'lost') {
    if (s.turns < LOSS_MIN_TURNS && s.damageDealt < LOSS_MIN_DAMAGE) return 0;
    return Math.round(XP_LOSS * (0.5 + clamp(s.damageDealt, 0, 1)));
  }
  if (s.forfeit && s.turns < FORFEIT_MIN_TURNS) return 0;
  const ratio = total(s.foe.stats) / Math.max(1, total(pet.stats));
  return Math.round(XP_WIN * clamp(0.5 + 0.5 * ratio, 0.5, 1.5));
}

/** The stat an opponent taught by winning: where it was furthest ahead, or else its best stat. */
export function lessonFrom(pet: PetState, foe: Fighter): Stat {
  const ahead = STATS.reduce((a, b) => (foe.stats[b] - pet.stats[b] > foe.stats[a] - pet.stats[a] ? b : a));
  if (foe.stats[ahead] > pet.stats[ahead]) return ahead;
  return STATS.reduce((a, b) => (foe.stats[b] > foe.stats[a] ? b : a));
}

/**
 * Apply a finished battle to the real pet: tiredness, mood, record, the winner's instant stat gain, and
 * battle experience for both sides. A full bar trains the stat it was taught most often (the most recent
 * teacher of that stat gets the credit), or a random one when no lesson is waiting.
 */
export function finishBattle(pet: PetState, outcome: Outcome, seed: number, summary: BattleSummary): BattleReward {
  const rand = mulberry32(seed);
  const reward: BattleReward = { stat: null, gain: 0, xp: 0, learned: null, teacher: null, upset: false };
  pet.energy = clamp(pet.energy - BATTLE_ENERGY, 0, maxEnergy(pet));
  pet.hunger = clamp(pet.hunger - BATTLE_HUNGER, 0, 100);
  const cap = STAT_CAPS[Math.min(pet.stage, STAT_CAPS.length - 1)];
  const open = () => STATS.filter((s) => pet.stats[s] < cap);

  reward.xp = battleXp(pet, outcome, summary);
  if (outcome === 'fled') {
    pet.mood = clamp(pet.mood - 3, 0, 100);
  } else if (outcome === 'lost') {
    pet.battles.losses++;
    pet.mood = clamp(pet.mood - 8, 0, 100);
    if (reward.xp > 0) {
      pet.lessons.push({ stat: lessonFrom(pet, summary.foe), from: summary.foe.name });
      pet.lessons = pet.lessons.slice(-MAX_LESSONS);
    }
  } else {
    pet.battles.wins++;
    pet.mood = clamp(pet.mood + 10, 0, 100);
    reward.upset = !summary.foe.wild && battleRating(summary.foe) >= UPSET_SHARE * battleRating(pet);
    const choices = open();
    if (choices.length) {
      const stat = choices[Math.floor(rand() * choices.length)];
      reward.stat = stat;
      reward.gain = Math.min(WIN_REWARD * (reward.upset ? 2 : 1), cap - pet.stats[stat]);
      pet.stats[stat] += reward.gain;
    }
  }

  pet.battleXp += reward.xp;
  if (pet.battleXp >= XP_PER_POINT) {
    const choices = open();
    if (!choices.length) {
      // Every stat is at this stage's limit: the bar waits, full, for the next life stage.
      pet.battleXp = XP_PER_POINT;
      return reward;
    }
    const counts = new Map<Stat, number>();
    for (const l of pet.lessons) if (choices.includes(l.stat)) counts.set(l.stat, (counts.get(l.stat) ?? 0) + 1);
    let stat: Stat;
    if (counts.size) {
      // Most often taught; ties go to the most recent lesson.
      const best = Math.max(...counts.values());
      let index = pet.lessons.length - 1;
      while (counts.get(pet.lessons[index].stat) !== best) index--;
      stat = pet.lessons[index].stat;
      reward.teacher = pet.lessons[index].from;
      pet.lessons.splice(index, 1);
    } else stat = choices[Math.floor(rand() * choices.length)];
    pet.stats[stat] += 1;
    pet.battleXp -= XP_PER_POINT;
    reward.learned = stat;
  }
  return reward;
}
