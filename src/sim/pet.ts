import { HOUR, isAsleep, MINUTE } from './clock';
import { formFor } from './evolution';
import { mulberry32 } from './rng';
import type { EggState, ElementType, LifeStage, NeglectMode, PetNeed, PetState, Settings } from './types';

export const LIFE_STAGES: LifeStage[] = ['baby', 'child', 'teen', 'adult', 'elder'];
/** Hours each life stage lasts; after the last one the pet retires and leaves an egg. */
export const STAGE_HOURS: Record<LifeStage, number> = { baby: 24, child: 72, teen: 120, adult: 504, elder: 168 };

/** Need loss per awake hour, by life stage: babies need the most attention. */
const DECAY: Record<LifeStage, Record<'hunger' | 'mood', number>> = {
  baby: { hunger: 25, mood: 18 },
  child: { hunger: 18, mood: 14 },
  teen: { hunger: 14, mood: 12 },
  adult: { hunger: 12, mood: 10 },
  elder: { hunger: 14, mood: 12 },
};
const ENERGY_DRAIN = 5;
/** An exhausted pet naps during the day until it has this much energy again. */
const NAP_UNTIL = 70;
const NAP_START = 5;
const ENERGY_REST_DARK = 25;
const ENERGY_REST_LIT = 10;
const SLEEP_DECAY_DARK = 0.1;
const SLEEP_DECAY_LIT = 0.3;

const MAX_DROPPINGS = 5;
const POOP_DELAY_H: [number, number] = [1.5, 3];
/** A dropping left this long (awake hours) counts as a care mistake. */
const DROPPING_MISTAKE_H = 1;

const SICK_HEALTH_LOSS = 8;
const HEALTH_RECOVERY = 4;
const SICK_DOSES = 2;
const NEGLECT_MULT: Record<NeglectMode, number> = { cozy: 0, gentle: 1, classic: 1.5 };
const GENTLE_HEALTH_FLOOR = 10;
const GENTLE_RUNAWAY_H = 24;

/** A need below this makes the pet call for attention. */
export const CALL_THRESHOLD = 20;
const CALL_TIMEOUT_H = 0.5;
const FAKE_CALL_EVERY_H: [number, number] = [3, 6];
/** Lights left on this long into the sleep window count as a care mistake. */
const LIGHTS_GRACE_H = 0.5;

const FULL = 90;
const MEAL = 35;
const PLAY_MOOD = 20;
const PLAY_ENERGY = 12;
const SCOLD_DISCIPLINE = 20;

const NAMES = ['Pip', 'Mochi', 'Bean', 'Nori', 'Tofu', 'Kiwi', 'Pebble', 'Sprout', 'Dot', 'Momo', 'Puff', 'Biscuit'];

const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));
const between = (rand: () => number, [lo, hi]: [number, number]) => lo + rand() * (hi - lo);

/** Deterministic randomness per game minute, so catch-up and live play roll the same dice. */
function roll(seed: number, t: number, salt: number): number {
  return mulberry32(seed ^ Math.floor(t / MINUTE) ^ (salt * 0x9e3779b1))();
}

export function suggestName(seed: number): string {
  return NAMES[seed % NAMES.length];
}

export function createPet(egg: EggState, type: ElementType, at: number, alone: boolean): PetState {
  const rand = mulberry32(egg.seed ^ 0xbab1);
  return {
    type,
    seed: egg.seed,
    name: suggestName(egg.seed),
    hatchedAt: at,
    hatchedAlone: alone,
    revealSeen: false,
    status: 'alive',
    hunger: 60,
    mood: alone ? 40 : 80,
    energy: 80,
    health: Math.max(40, egg.health),
    discipline: 0,
    sick: false,
    napping: false,
    sickDoses: 0,
    droppings: [],
    poopsDue: [],
    meals: 0,
    call: null,
    nextFakeCallAt: at + between(rand, FAKE_CALL_EVERY_H) * HOUR,
    neglectHours: 0,
    mistakes: [0, 0, 0, 0, 0],
    lightsMistakeNight: null,
    careMistakes: egg.careMistakes,
    stage: 0,
    form: 'baby',
    shownStage: 0,
    shownForm: 'baby',
    stats: { power: 0, speed: 0, guard: 0, wits: 0, ...(egg.heritage && { [egg.heritage.stat]: egg.heritage.bonus }) },
    trainings: 0,
    path: ['baby'],
    battles: { wins: 0, losses: 0 },
    generation: egg.heritage?.generation ?? 1,
  };
}

/** Fill in fields added after a save was written (milestone 1 pets had only a few). */
export function migratePet(pet: Partial<PetState> & Pick<PetState, 'type' | 'seed' | 'hatchedAt'>): PetState {
  const base = createPet(
    { seed: pet.seed, health: pet.health ?? 100, careMistakes: pet.careMistakes ?? 0 } as EggState,
    pet.type,
    pet.hatchedAt,
    pet.hatchedAlone ?? false,
  );
  const merged = { ...base, ...pet };
  if (!merged.path.includes(merged.form)) merged.path = [...merged.path, merged.form];
  return merged;
}

export function ageHours(pet: PetState, now: number): number {
  return (now - pet.hatchedAt) / HOUR;
}

export function lifeStageIndex(pet: PetState, now: number): number {
  let h = ageHours(pet, now);
  for (let i = 0; i < LIFE_STAGES.length; i++) {
    h -= STAGE_HOURS[LIFE_STAGES[i]];
    if (h < 0) return i;
  }
  return LIFE_STAGES.length;
}

export function lifeStage(pet: PetState, now: number): LifeStage {
  return LIFE_STAGES[Math.min(lifeStageIndex(pet, now), LIFE_STAGES.length - 1)];
}

export function hygiene(pet: PetState): number {
  return 100 * (1 - pet.droppings.length / MAX_DROPPINGS);
}

/** The most pressing unmet need, if any is below the call threshold. */
export function lowestNeed(pet: PetState): PetNeed | null {
  // Energy is not on this list: a tired pet naps on its own instead of calling.
  const needs: [PetNeed, number][] = [
    ['hunger', pet.hunger],
    ['mood', pet.mood],
  ];
  needs.sort((a, b) => a[1] - b[1]);
  return needs[0][1] < CALL_THRESHOLD ? needs[0][0] : null;
}

function nightKey(t: number, settings: Settings): string {
  // Times after midnight belong to the night that started the evening before.
  const d = new Date(t);
  if (d.getHours() < settings.sleepEnd) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function mistake(pet: PetState, now: number): void {
  pet.careMistakes++;
  pet.mistakes[Math.min(lifeStageIndex(pet, now), LIFE_STAGES.length - 1)]++;
}

/** Advance the pet by dtH game hours, ending at game time t. */
export function tickPet(pet: PetState, t: number, dtH: number, settings: Settings, lightsOn: boolean): void {
  if (pet.status !== 'alive') return;
  const stageIndex = lifeStageIndex(pet, t);
  if (stageIndex >= LIFE_STAGES.length) {
    pet.status = 'retired';
    return;
  }
  while (pet.stage < stageIndex) {
    pet.stage++;
    pet.form = formFor(pet, pet.stage);
    if (!pet.path.includes(pet.form)) pet.path.push(pet.form);
  }
  const stage = lifeStage(pet, t);
  const night = isAsleep(t, settings);
  const mult = NEGLECT_MULT[settings.neglect];

  if (night) pet.napping = false;
  else if (pet.energy <= NAP_START) pet.napping = true;
  else if (pet.energy >= NAP_UNTIL) pet.napping = false;
  const asleep = night || pet.napping;

  // Needs.
  const dark = !lightsOn || pet.napping;
  const decayMul = asleep ? (dark ? SLEEP_DECAY_DARK : SLEEP_DECAY_LIT) : 1;
  pet.hunger = clamp(pet.hunger - DECAY[stage].hunger * dtH * decayMul);
  pet.mood = clamp(pet.mood - DECAY[stage].mood * dtH * decayMul * (pet.sick ? 1.5 : 1));
  pet.energy = clamp(pet.energy + (asleep ? (dark ? ENERGY_REST_DARK : ENERGY_REST_LIT) : -ENERGY_DRAIN) * dtH);

  // Digestion.
  while (pet.poopsDue.length && pet.poopsDue[0] <= t) {
    pet.poopsDue.shift();
    if (pet.droppings.length < MAX_DROPPINGS) {
      pet.droppings.push({
        angle: roll(pet.seed, t, 1) * Math.PI * 2,
        dist: 0.9 + roll(pet.seed, t, 2) * 1.4,
        at: t,
        awakeHours: 0,
        counted: false,
      });
    }
  }
  for (const d of pet.droppings) {
    if (!night) d.awakeHours += dtH;
    if (!d.counted && d.awakeHours >= DROPPING_MISTAKE_H) {
      d.counted = true;
      mistake(pet, t);
    }
  }

  // Sickness: dirt and hunger make it likely; Cozy mode skips it entirely.
  if (!pet.sick && !asleep && mult > 0) {
    const perHour =
      0.15 * Math.max(0, pet.droppings.length - 1) + (pet.hunger <= 0 ? 0.2 : 0) + (pet.mood <= 0 ? 0.1 : 0);
    if (perHour > 0 && roll(pet.seed, t, 3) < perHour * dtH * mult) {
      pet.sick = true;
      pet.sickDoses = SICK_DOSES;
    }
  }

  // Health.
  if (pet.sick) pet.health -= SICK_HEALTH_LOSS * dtH * mult * (asleep ? 0.3 : 1);
  else if (pet.hunger > 30 && pet.mood > 30) pet.health += HEALTH_RECOVERY * dtH;
  pet.health = clamp(pet.health, settings.neglect === 'gentle' ? GENTLE_HEALTH_FLOOR : 0);
  if (settings.neglect === 'cozy') pet.health = Math.max(pet.health, 50);
  if (settings.neglect === 'classic' && pet.health <= 0) {
    pet.status = 'died';
    return;
  }

  // Running away after a long stretch of total neglect (Gentle).
  if (!asleep && pet.hunger <= 0 && pet.mood <= 0) pet.neglectHours += dtH;
  else if (pet.hunger > 30 && pet.mood > 30) pet.neglectHours = Math.max(0, pet.neglectHours - dtH);
  if (settings.neglect === 'gentle' && pet.neglectHours >= GENTLE_RUNAWAY_H) {
    pet.status = 'ranAway';
    return;
  }

  // Attention calls (paused while asleep).
  if (asleep) {
    pet.nextFakeCallAt += dtH * HOUR;
    if (night && lightsOn && pet.lightsMistakeNight !== nightKey(t, settings)) {
      const sleepStart = new Date(t);
      sleepStart.setHours(settings.sleepStart, 0, 0, 0);
      if (sleepStart.getTime() > t) sleepStart.setDate(sleepStart.getDate() - 1);
      if (t - sleepStart.getTime() >= LIGHTS_GRACE_H * HOUR) {
        pet.lightsMistakeNight = nightKey(t, settings);
        mistake(pet, t);
      }
    }
    return;
  }
  if (pet.call?.kind === 'need' && lowestNeed(pet) === null && !pet.sick) pet.call = null;
  if (pet.call && t - pet.call.at >= CALL_TIMEOUT_H * HOUR) {
    if (pet.call.kind === 'fake') pet.discipline = clamp(pet.discipline - 5);
    pet.call = null;
    mistake(pet, t);
  }
  if (!pet.call && (lowestNeed(pet) !== null || pet.sick)) {
    pet.call = { kind: 'need', at: t };
  } else if (!pet.call && t >= pet.nextFakeCallAt) {
    pet.call = { kind: 'fake', at: t };
    pet.nextFakeCallAt = t + between(() => roll(pet.seed, t, 4), FAKE_CALL_EVERY_H) * HOUR;
  }
}

// ---------- actions ----------

export type FeedResult = 'ok' | 'full' | 'asleep';
export type PlayResult = 'ok' | 'tired' | 'asleep';
export type MedicineResult = 'cured' | 'dose' | 'notSick';
export type ScoldResult = 'disciplined' | 'unfair' | 'confused';

export function isSleeping(pet: PetState, now: number, settings: Settings): boolean {
  return pet.napping || isAsleep(now, settings);
}

export function feedPet(pet: PetState, now: number, settings: Settings): FeedResult {
  if (isSleeping(pet, now, settings)) return 'asleep';
  if (pet.hunger >= FULL) return 'full';
  pet.hunger = clamp(pet.hunger + MEAL);
  pet.mood = clamp(pet.mood + 3);
  pet.meals++;
  pet.poopsDue.push(now + between(() => roll(pet.seed, now, 5 + pet.meals), POOP_DELAY_H) * HOUR);
  pet.poopsDue.sort((a, b) => a - b);
  return 'ok';
}

export function cleanUp(pet: PetState): number {
  const n = pet.droppings.length;
  pet.droppings = [];
  if (n) pet.mood = clamp(pet.mood + 5);
  return n;
}

export function playWith(pet: PetState, now: number, settings: Settings): PlayResult {
  if (isSleeping(pet, now, settings)) return 'asleep';
  if (pet.energy < PLAY_ENERGY) return 'tired';
  pet.mood = clamp(pet.mood + PLAY_MOOD);
  pet.energy = clamp(pet.energy - PLAY_ENERGY);
  pet.hunger = clamp(pet.hunger - 4);
  return 'ok';
}

export function giveMedicine(pet: PetState): MedicineResult {
  if (!pet.sick) {
    pet.mood = clamp(pet.mood - 10);
    return 'notSick';
  }
  pet.sickDoses--;
  if (pet.sickDoses > 0) return 'dose';
  pet.sick = false;
  if (pet.call?.kind === 'need' && lowestNeed(pet) === null) pet.call = null;
  return 'cured';
}

/** Scolding fixes tantrums; scolding a pet with a real need, or for nothing, just upsets it. */
export function scold(pet: PetState): ScoldResult {
  if (pet.call?.kind === 'fake') {
    pet.discipline = clamp(pet.discipline + SCOLD_DISCIPLINE);
    pet.call = null;
    return 'disciplined';
  }
  pet.mood = clamp(pet.mood - (pet.call ? 15 : 8));
  return pet.call ? 'unfair' : 'confused';
}

export function pat(pet: PetState): void {
  pet.mood = clamp(pet.mood + 2);
}
