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
  /** A wild creature's rank (missing: 'match'), which sets its strength, tactics and reward. */
  rank?: WildRank;
  /** A wild creature's traits. */
  traits?: WildTrait[];
}

export type MoveId = 'tackle' | 'element' | 'rush' | 'focus' | 'crush' | 'flurry' | 'shell' | 'trick';

export interface Move {
  power: number;
  accuracy: number;
  /** Uses the attacker's element, so the type triangle applies. */
  typed: boolean;
  hits?: number;
  /** Acts before a move without this, if the pet is the faster one. */
  first?: boolean;
  effect?: 'focus' | 'shell' | 'daze' | 'shatter' | 'flinch';
}

/**
 * Each adult move works best against one other form, in a cycle: Power Slam breaks Shell Up (Power › Guard),
 * Shell Up's thorns punish Flurry's many hits (Guard › Speed), Flurry makes a slower foe flinch out of Focus and
 * Mind Trick's daze (Speed › Wits), and Mind Trick turns a strong foe's own Power against it (Wits › Power).
 * The numbers were tuned by simulation so that pets with the same stat points win about as often whatever
 * they grew into (see DESIGN.md, Battles).
 */
export const MOVES: Record<MoveId, Move> = {
  tackle: { power: 45, accuracy: 100, typed: false },
  element: { power: 47, accuracy: 95, typed: true },
  rush: { power: 70, accuracy: 85, typed: false },
  /** A light hit that powers up the next one. */
  focus: { power: 20, accuracy: 95, typed: false, effect: 'focus' },
  crush: { power: 50, accuracy: 80, typed: true, effect: 'shatter' },
  flurry: { power: 15, accuracy: 95, typed: false, hits: 3, first: true, effect: 'flinch' },
  shell: { power: 0, accuracy: 100, typed: false, effect: 'shell' },
  trick: { power: 50, accuracy: 95, typed: true, effect: 'daze' },
};

const ADULT_MOVE: Record<Stat, MoveId> = { power: 'crush', speed: 'flurry', guard: 'shell', wits: 'trick' };
/** Each element beats the next one: Tide › Ember › Bloom › Tide. Astral has no strength or weakness. */
const BEATS: Partial<Record<ElementType, ElementType>> = { tide: 'ember', ember: 'bloom', bloom: 'tide' };
export const STRONG = 1.2;
export const WEAK = 0.83;
/** Discipline at which a pet always obeys; below it, up to this chance of ignoring an order. */
const OBEY_DISCIPLINE = 50;
const MAX_DISOBEY = 0.4;
/** Focus: the next damaging hit does this much more. */
const FOCUS_BOOST = 1.2;
/** Shell Up heals this share of health and adds a layer: Guard × (1 + SHELL_GUARD) plus SHELL_ARMOR, per layer. */
const SHELL_HEAL = 0.22;
const SHELL_GUARD = 0.08;
const SHELL_ARMOR = 80;
const MAX_GUARD_UP = 2;
/** Each hit that lands on a shelled pet costs the attacker this much health. */
const THORNS = 2;
const DAZE_CHANCE = 0.34;
/** Critical hits: this chance plus Wits / CRIT_WITS, for CRIT_DAMAGE times the damage, past any Shell Up. */
const CRIT_BASE = 0.05;
const CRIT_WITS = 200;
const CRIT_DAMAGE = 2;
/** Each point of Speed ahead dodges 1/DODGE_SPEED of attacks, up to MAX_DODGE. */
const DODGE_SPEED = 140;
const MAX_DODGE = 0.2;
/** Each point of Speed ahead adds 1/ORDER_SPEED to the chance of moving first, between 10% and 90%. */
const ORDER_SPEED = 80;
const HP_BASE = 74;
const HP_PER_STAGE = 15;
const HP_PER_GUARD = 0.2;
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
  const hp = Math.round(HP_BASE + HP_PER_STAGE * Math.min(f.stage, 3) + HP_PER_GUARD * f.stats.guard);
  return f.traits?.includes('tough') ? Math.round(hp * TOUGH_HP) : hp;
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

// ---------- wild creatures ----------

/**
 * How strong a wild creature is. Its stats are built from the pet's own (times `strength`), so every rank stays a
 * fair fight at any stage; strong ones and champions may go past the stage's stat cap (`capOver`), bring traits,
 * pick their moves better (`randomMove`: the chance of a random attack instead of the best one) and pay more.
 * Tuned by simulation: with sensible moves a pet wins about 60–90% against runts, 60–75% against matches,
 * 30–45% against strong creatures and 10–20% against champions.
 */
export type WildRank = 'runt' | 'match' | 'strong' | 'champion';
export const WILD_RANKS: Record<
  WildRank,
  { strength: [number, number]; capOver: number; traits: number; randomMove: number; reward: number; xp: number; lossMood: number }
> = {
  runt: { strength: [0.7, 0.85], capOver: 1, traits: 0, randomMove: 0.4, reward: 1, xp: 1, lossMood: 8 },
  match: { strength: [0.9, 1.1], capOver: 1, traits: 0, randomMove: 0.25, reward: 2, xp: 1, lossMood: 8 },
  strong: { strength: [1, 1.15], capOver: 1.15, traits: 1, randomMove: 0.15, reward: 3, xp: 1.5, lossMood: 4 },
  champion: { strength: [1.1, 1.25], capOver: 1.25, traits: 2, randomMove: 0.05, reward: 5, xp: 2, lossMood: 4 },
};
const RANKS: WildRank[] = ['runt', 'match', 'strong', 'champion'];
/** How often each rank turns up, by life stage (child … elder): later stages meet tougher creatures. */
const RANK_WEIGHTS: Record<number, [number, number, number, number]> = {
  1: [35, 55, 10, 0],
  2: [20, 55, 20, 5],
  3: [10, 45, 33, 12],
  4: [10, 40, 35, 15],
};

/**
 * Heat: a pet's run of form against wild creatures, +1 a win, −2 a loss, within these bounds. A hot pet meets
 * strong creatures and champions more often (champions about 1.6 times as often at the top), a struggling one
 * about twice as many runts.
 */
export const HEAT_MIN = -3;
export const HEAT_MAX = 5;

/** Tough: more health. Swift: a little faster than the pet. Fierce: more critical hits. Rival: the element that beats the pet's. */
export type WildTrait = 'tough' | 'swift' | 'fierce' | 'rival';
const TRAITS: WildTrait[] = ['tough', 'swift', 'fierce', 'rival'];
const TOUGH_HP = 1.2;
const SWIFT_LEAD = 5;
const FIERCE_WITS = 25;
/** The element that beats each one. */
const COUNTER: Partial<Record<ElementType, ElementType>> = { ember: 'tide', tide: 'bloom', bloom: 'ember' };

/** A wild encounter stays the same for this long (and until the next fight), so backing off doesn't reroll it. */
const ENCOUNTER_MS = 15 * 60_000;

/** The seed for the creature the pet would meet now. */
export function encounterSeed(pet: Pick<PetState, 'seed' | 'battles'>, now: number): number {
  const fights = pet.battles.wins + pet.battles.losses;
  return Math.floor(mulberry32(pet.seed ^ Math.floor(now / ENCOUNTER_MS) ^ Math.imul(fights + 1, 0x9e3779b1))() * 2 ** 32);
}

function rankFor(stage: number, heat: number, r: () => number): WildRank {
  const [runt, match, strong, champion] = RANK_WEIGHTS[clamp(stage, 1, 4)];
  const weights = [
    runt * Math.max(0.2, 1 - 0.15 * heat),
    match,
    strong * Math.max(0.2, 1 + 0.25 * heat),
    champion * Math.max(0, 1 + 0.25 * heat),
  ];
  let x = r() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < RANKS.length; i++) if ((x -= weights[i]) < 0) return RANKS[i];
  return 'match';
}

/**
 * A wild creature for this pet: a rank drawn by its life stage and heat, then stats built from the pet's own,
 * at the same life stage (an elder meets adults).
 */
export function wildFoe(
  pet: Pick<PetState, 'stage' | 'stats' | 'type'> & { wildHeat?: number },
  seed: number,
): Fighter {
  const r = mulberry32(seed);
  const rank = rankFor(pet.stage, pet.wildHeat ?? 0, r);
  const spec = WILD_RANKS[rank];
  const traits: WildTrait[] = [];
  // An astral pet has no element that beats it.
  const possible = TRAITS.filter((tr) => tr !== 'rival' || COUNTER[pet.type]);
  while (traits.length < spec.traits) {
    const trait = possible[Math.floor(r() * possible.length)];
    if (!traits.includes(trait)) traits.push(trait);
  }
  const type: ElementType = traits.includes('rival')
    ? COUNTER[pet.type]!
    : r() < 0.06
      ? 'astral'
      : (['ember', 'tide', 'bloom'] as const)[Math.floor(r() * 3)];
  const stage = clamp(pet.stage, 1, 3);
  const own = STATS.reduce((sum, s) => sum + pet.stats[s], 0);
  const [lo, hi] = spec.strength;
  // Even an untrained pet meets creatures with a few points, so early battles aren't all zeros.
  const total = Math.max(own, [0, 10, 40, 100][stage]) * (lo + r() * (hi - lo));
  const weights = STATS.map(() => 0.3 + r());
  const sum = weights.reduce((a, b) => a + b, 0);
  const cap = Math.round(STAT_CAPS[stage] * spec.capOver);
  const stats = Object.fromEntries(
    STATS.map((s, i) => [s, clamp(Math.round((total * weights[i]) / sum), 0, cap)]),
  ) as Record<Stat, number>;
  if (traits.includes('swift')) stats.speed = Math.max(stats.speed, pet.stats.speed + SWIFT_LEAD);
  if (traits.includes('fierce')) stats.wits += FIERCE_WITS;
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
    rank,
    traits,
  };
}

// ---------- the battle itself ----------

export type SideKey = 'a' | 'b';

export interface Side {
  f: Fighter;
  moves: MoveId[];
  maxHp: number;
  hp: number;
  /** Next damaging move hits FOCUS_BOOST times harder. */
  focus: boolean;
  /** Layers of Shell Up; one wears off each time the pet attacks. */
  guardUp: number;
  dazed: boolean;
  /** This round: has it acted yet, and did a Flurry make it flinch before it could? */
  acted: boolean;
  flinched: boolean;
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
  /** The attacker hurt itself on the target's Shell Up. */
  | { kind: 'thorns'; side: SideKey; damage: number; hp: number }
  /** Power Slam broke the target's Shell Up. */
  | { kind: 'shatter'; side: SideKey }
  /** Flurry hit the target before it moved: its Focus or Mind Trick's daze won't work this round. */
  | { kind: 'flinch'; side: SideKey }
  | { kind: 'faint'; side: SideKey };

function side(f: Fighter): Side {
  const hp = maxHp(f);
  return { f, moves: movesFor(f), maxHp: hp, hp, focus: false, guardUp: 0, dazed: false, acted: false, flinched: false };
}

export function createBattle(player: Fighter, foe: Fighter, seed: number): Battle {
  return { a: side(player), b: side(foe), turn: 0, winner: null, rand: mulberry32(seed) };
}

const other = (k: SideKey): SideKey => (k === 'a' ? 'b' : 'a');

export function disobeyChance(f: Fighter): number {
  return MAX_DISOBEY * clamp(1 - f.discipline / OBEY_DISCIPLINE, 0, 1);
}

/** Mind Trick hits with the stronger of the two pets' Power: a strong foe's own strength turned against it. */
const attackOf = (s: Side, t: Side, move: MoveId) => 10 + (move === 'trick' ? Math.max(s.f.stats.power, t.f.stats.power) : s.f.stats.power);
/** Power Slam goes straight through Shell Up, and so does a critical hit. */
const defenseOf = (t: Side, ignoreShell: boolean) => {
  const up = ignoreShell ? 0 : t.guardUp;
  return (10 + t.f.stats.guard) * (1 + SHELL_GUARD * up) + SHELL_ARMOR * up;
};

/** About how much damage a move does now, counting its extra effect, for the computer's choice. */
function moveValue(s: Side, t: Side, move: MoveId): number {
  const mv = MOVES[move];
  const atk = attackOf(s, t, move);
  const def = defenseOf(t, move === 'crush');
  const hits = mv.hits ?? 1;
  let v = mv.power * (mv.accuracy / 100) * hits * (mv.typed ? typeFactor(s.f.type, t.f.type) : 1) * (atk / (atk + def));
  if (t.guardUp > 0) v -= THORNS * hits * 0.5;
  if (move === 'trick' && !t.dazed) v *= 1 + DAZE_CHANCE * 0.6;
  if (move === 'crush' && t.guardUp > 0) v *= 1.25;
  if (move === 'focus' && !s.focus) v *= 1 + 0.5 * (FOCUS_BOOST - 1);
  return v;
}

/**
 * The computer's choice: Shell Up when hurt, a daze or a focus now and then, else the move that should do the
 * most damage, counting its extra effect (a wild creature's rank decides how often it picks any attack instead).
 */
export function aiMove(b: Battle, key: SideKey): MoveId {
  const s = b[key];
  const t = b[other(key)];
  const r = b.rand;
  const shell = s.moves.includes('shell') && s.guardUp < MAX_GUARD_UP;
  if (shell && s.hp < s.maxHp * 0.4 && r() < 0.6) return 'shell';
  if (shell && s.guardUp === 0 && s.hp < s.maxHp * 0.8 && r() < 0.35) return 'shell';
  if (s.moves.includes('trick') && !t.dazed && r() < 0.3) return 'trick';
  if (s.moves.includes('focus') && !s.focus && s.hp > s.maxHp * 0.6 && r() < 0.2) return 'focus';
  const attacks = s.moves.filter((m) => MOVES[m].power > 0);
  // Now and then any attack, not the best: clumsy runts more often, champions hardly ever.
  if (r() < WILD_RANKS[s.f.rank ?? 'match'].randomMove) return attacks[Math.floor(r() * attacks.length)];
  return attacks.reduce((best, m) => (moveValue(s, t, m) > moveValue(s, t, best) ? m : best));
}

/**
 * Play one round: both sides act, and the events describe what happened, in order. Flurry goes first if the pet is
 * faster; otherwise more Speed makes moving first more likely. Without `moveB` the computer picks side b's move.
 * Given the same battle and moves, every device computes the same result, which is what live battles rely on.
 */
export function playTurn(b: Battle, moveA: MoveId, moveB?: MoveId): BattleEvent[] {
  if (b.winner) return [];
  const events: BattleEvent[] = [];
  const chosen: Record<SideKey, MoveId> = { a: moveA, b: moveB ?? aiMove(b, 'b') };
  const sa = b.a.f.stats.speed;
  const sb = b.b.f.stats.speed;
  const fa = !!MOVES[chosen.a].first && sa > sb;
  const fb = !!MOVES[chosen.b].first && sb > sa;
  const aFirst = fa !== fb ? fa : b.rand() < clamp(0.5 + (sa - sb) / ORDER_SPEED, 0.1, 0.9);
  b.a.acted = b.b.acted = b.a.flinched = b.b.flinched = false;
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
  s.acted = true;
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
  if (m.effect === 'shell') {
    s.guardUp = Math.min(MAX_GUARD_UP, s.guardUp + 1);
    events.push({ kind: 'guard', side: key });
    const amount = Math.min(s.maxHp - s.hp, Math.round(s.maxHp * SHELL_HEAL));
    s.hp += amount;
    events.push({ kind: 'heal', side: key, amount, hp: s.hp });
    return;
  }

  const atk = attackOf(s, t, move);
  const def = defenseOf(t, m.effect === 'shatter');
  const dodge = clamp((t.f.stats.speed - s.f.stats.speed) / DODGE_SPEED, 0, MAX_DODGE);
  const factor = m.typed ? typeFactor(s.f.type, t.f.type) : 1;
  const hits = m.hits ?? 1;
  let landed = 0;
  for (let i = 0; i < hits && t.hp > 0 && s.hp > 0; i++) {
    if (r() >= (m.accuracy / 100) * (1 - dodge)) {
      if (hits === 1) events.push({ kind: 'miss', side: key });
      continue;
    }
    const crit = r() < CRIT_BASE + s.f.stats.wits / CRIT_WITS;
    const d = crit ? defenseOf(t, true) : def;
    const raw = m.power * (atk / (atk + d)) * 1.1 * factor * (crit ? CRIT_DAMAGE : 1) * (s.focus ? FOCUS_BOOST : 1) * (0.85 + 0.15 * r());
    const damage = Math.min(t.hp, Math.max(1, Math.round(raw)));
    t.hp -= damage;
    landed++;
    events.push({ kind: 'hit', side: key, target: tk, damage, factor, crit, hp: t.hp });
    if (t.guardUp > 0 && t.hp > 0) {
      const hurt = Math.min(s.hp, THORNS);
      s.hp -= hurt;
      events.push({ kind: 'thorns', side: key, damage: hurt, hp: s.hp });
    }
  }
  if (hits > 1) events.push(landed ? { kind: 'hits', side: key, n: landed } : { kind: 'miss', side: key });
  // Focus powers up the next hit, unless a Flurry made the pet flinch first.
  s.focus = m.effect === 'focus' && !s.flinched;
  if (s.focus) events.push({ kind: 'focus', side: key });
  if (s.guardUp > 0) s.guardUp--;
  if (m.effect === 'shatter' && landed && t.guardUp > 0) {
    t.guardUp = 0;
    events.push({ kind: 'shatter', side: tk });
  }
  if (m.effect === 'flinch' && landed && !t.acted && t.hp > 0) {
    t.flinched = true;
    events.push({ kind: 'flinch', side: tk });
  }
  if (m.effect === 'daze' && landed && t.hp > 0 && !s.flinched && r() < DAZE_CHANCE) {
    t.dazed = true;
    events.push({ kind: 'dazed', side: tk });
  }
  if (t.hp <= 0) {
    events.push({ kind: 'faint', side: tk });
    b.winner = key;
  } else if (s.hp <= 0) {
    events.push({ kind: 'faint', side: key });
    b.winner = tk;
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
  /** The wild creature's rank, which set the reward (null for pets). */
  rank: WildRank | null;
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
  const rank = summary.foe.wild ? (summary.foe.rank ?? 'match') : null;
  const spec = WILD_RANKS[rank ?? 'match'];
  const reward: BattleReward = { stat: null, gain: 0, xp: 0, learned: null, teacher: null, upset: false, rank };
  pet.energy = clamp(pet.energy - BATTLE_ENERGY, 0, maxEnergy(pet));
  pet.hunger = clamp(pet.hunger - BATTLE_HUNGER, 0, 100);
  const cap = STAT_CAPS[Math.min(pet.stage, STAT_CAPS.length - 1)];
  const open = () => STATS.filter((s) => pet.stats[s] < cap);

  reward.xp = Math.round(battleXp(pet, outcome, summary) * spec.xp);
  // Against wild creatures, the run of form: a win +1, a loss −2 (running away changes nothing).
  if (rank && outcome !== 'fled') {
    pet.wildHeat = clamp((pet.wildHeat ?? 0) + (outcome === 'won' ? 1 : -2), HEAT_MIN, HEAT_MAX);
  }
  if (outcome === 'fled') {
    pet.mood = clamp(pet.mood - 3, 0, 100);
  } else if (outcome === 'lost') {
    pet.battles.losses++;
    // Losing to a strong creature or a champion is no shame.
    pet.mood = clamp(pet.mood - spec.lossMood, 0, 100);
    if (reward.xp > 0) {
      pet.lessons.push({ stat: lessonFrom(pet, summary.foe), from: summary.foe.name });
      pet.lessons = pet.lessons.slice(-MAX_LESSONS);
    }
  } else {
    pet.battles.wins++;
    if (rank === 'champion') pet.battles.champions = (pet.battles.champions ?? 0) + 1;
    pet.mood = clamp(pet.mood + 10, 0, 100);
    reward.upset = !summary.foe.wild && battleRating(summary.foe) >= UPSET_SHARE * battleRating(pet);
    const choices = open();
    if (choices.length) {
      const stat = choices[Math.floor(rand() * choices.length)];
      reward.stat = stat;
      const points = rank ? spec.reward : WIN_REWARD * (reward.upset ? 2 : 1);
      reward.gain = Math.min(points, cap - pet.stats[stat]);
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
