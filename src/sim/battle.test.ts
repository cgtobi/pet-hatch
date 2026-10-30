import { describe, expect, it } from 'vitest';
import {
  aiMove,
  battleXp,
  lessonFrom,
  XP_PER_POINT,
  type BattleSummary,
  createBattle,
  disobeyChance,
  fighterFromPet,
  finishBattle,
  MAX_TURNS,
  maxHp,
  movesFor,
  playTurn,
  STRONG,
  typeFactor,
  WEAK,
  wildFoe,
  type Fighter,
} from './battle';
import { decodeFighter, encodeFighter } from './battlecode';
import { DEFAULT_SETTINGS, hatch, newGame } from './game';
import { migratePet } from './pet';
import { STAT_CAPS, STATS } from './training';

function fighter(over: Partial<Fighter> = {}): Fighter {
  return {
    name: 'Pip',
    type: 'ember',
    form: 'adult.power',
    stage: 3,
    stats: { power: 60, speed: 40, guard: 50, wits: 30 },
    discipline: 100,
    teen: 'teen.physical',
    seed: 1,
    wild: false,
    ...over,
  };
}

/** Play until someone wins, the player always using its first damaging move. */
function fight(a: Fighter, b: Fighter, seed: number) {
  const battle = createBattle(a, b, seed);
  while (!battle.winner && battle.turn < MAX_TURNS) playTurn(battle, 'element');
  return battle;
}

describe('battle rules', () => {
  it('follows the type triangle; Astral is neutral', () => {
    expect(typeFactor('tide', 'ember')).toBe(STRONG);
    expect(typeFactor('ember', 'bloom')).toBe(STRONG);
    expect(typeFactor('bloom', 'tide')).toBe(STRONG);
    expect(typeFactor('ember', 'tide')).toBe(WEAK);
    expect(typeFactor('astral', 'ember')).toBe(1);
    expect(typeFactor('tide', 'astral')).toBe(1);
  });

  it('learns moves as it grows: 2 as a child, 3 as a teen, 4 as an adult', () => {
    expect(movesFor(fighter({ stage: 1, form: 'child.bright', teen: null }))).toEqual(['tackle', 'element']);
    expect(movesFor(fighter({ stage: 2, form: 'teen.technical', teen: 'teen.technical' }))).toEqual([
      'tackle',
      'element',
      'focus',
    ]);
    expect(movesFor(fighter({ form: 'adult.speed' }))).toEqual(['tackle', 'element', 'rush', 'flurry']);
    expect(movesFor(fighter({ stage: 4, form: 'adult.wits', teen: 'teen.technical' }))).toEqual([
      'tackle',
      'element',
      'focus',
      'trick',
    ]);
  });

  it('lets type advantage decide an even fight most of the time', () => {
    let tideWins = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const b = fight(fighter({ type: 'tide' }), fighter({ type: 'ember', name: 'Foe' }), seed);
      if (b.winner === 'a') tideWins++;
    }
    expect(tideWins).toBeGreaterThan(140);
  });

  it('makes training pay off', () => {
    let wins = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const strong = fighter({ stats: { power: 90, speed: 70, guard: 80, wits: 40 } });
      const weak = fighter({ name: 'Foe', stats: { power: 30, speed: 20, guard: 30, wits: 10 } });
      if (fight(strong, weak, seed).winner === 'a') wins++;
    }
    expect(wins).toBeGreaterThan(190);
  });

  it('ends with a winner and consistent HP', () => {
    const b = fight(fighter(), fighter({ name: 'Foe', type: 'bloom' }), 42);
    expect(b.winner).not.toBeNull();
    const loser = b.winner === 'a' ? b.b : b.a;
    expect(loser.hp).toBe(0);
    expect(b.a.hp).toBeLessThanOrEqual(maxHp(b.a.f));
  });

  it('makes undisciplined pets ignore orders sometimes', () => {
    expect(disobeyChance(fighter())).toBe(0);
    expect(disobeyChance(fighter({ discipline: 0 }))).toBeCloseTo(0.4);
    let ignored = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const b = createBattle(fighter({ discipline: 0 }), fighter({ name: 'Foe', stats: { power: 0, speed: 0, guard: 100, wits: 0 } }), seed);
      const events = playTurn(b, 'tackle');
      if (events.some((e) => (e.kind === 'ignore' || e.kind === 'wild') && e.side === 'a')) ignored++;
    }
    expect(ignored).toBeGreaterThan(20);
    expect(ignored).toBeLessThan(60);
  });

  it('has the computer heal when low and otherwise pick a strong move', () => {
    const b = createBattle(fighter({ type: 'tide', form: 'adult.guard' }), fighter({ type: 'ember' }), 3);
    b.b.hp = 10;
    b.b.moves = ['tackle', 'element', 'focus'];
    const picks = Array.from({ length: 50 }, () => aiMove(b, 'b'));
    expect(picks.filter((m) => m === 'focus').length).toBeGreaterThan(20);
    b.b.hp = b.b.maxHp;
    b.b.moves = ['tackle', 'rush'];
    const attacks = Array.from({ length: 50 }, () => aiMove(b, 'b'));
    expect(attacks.filter((m) => m === 'rush').length).toBeGreaterThan(30);
  });
});

describe('wild creatures', () => {
  it('match the pet’s stage and stay within its caps', () => {
    for (let seed = 1; seed <= 50; seed++) {
      for (const stage of [1, 2, 3, 4]) {
        const foe = wildFoe({ stage, stats: { power: 20, speed: 20, guard: 20, wits: 20 } }, seed);
        expect(foe.stage).toBe(Math.min(stage, 3));
        expect(foe.wild).toBe(true);
        for (const s of STATS) expect(foe.stats[s]).toBeLessThanOrEqual(STAT_CAPS[foe.stage]);
        expect(movesFor(foe).length).toBe(Math.min(stage, 3) + 1);
      }
    }
  });
});

describe('battle results', () => {
  function pet() {
    const s = newGame(Date.now(), DEFAULT_SETTINGS, 9);
    const p = hatch(s, Date.now(), false);
    Object.assign(p, { stage: 2, form: 'teen.physical', energy: 90, mood: 50, hunger: 80 });
    p.stats = { power: 20, speed: 20, guard: 20, wits: 20 };
    return p;
  }
  /** A real fight against an equal opponent unless overridden. */
  const fought = (over: Partial<BattleSummary> = {}): BattleSummary => ({
    turns: 5,
    damageDealt: 0.5,
    foe: fighter({ name: 'Mochi', stage: 2, form: 'teen.physical', stats: { power: 20, speed: 20, guard: 20, wits: 20 } }),
    forfeit: false,
    gaveUp: false,
    ...over,
  });

  it('rewards a win with a stat point, experience and the record', () => {
    const p = pet();
    const r = finishBattle(p, 'won', 5, fought());
    expect(p.battles).toEqual({ wins: 1, losses: 0 });
    expect(r.gain).toBe(2);
    expect(p.stats[r.stat!]).toBe(22);
    expect(r.xp).toBe(4);
    expect(p.battleXp).toBe(4);
    expect(p.energy).toBe(65);
    expect(p.mood).toBe(60);
  });

  it('doubles the stat points for beating a much stronger pet', () => {
    const p = pet();
    // Ratings 120 (this pet) and 165: over 35% stronger.
    const strong = fighter({ name: 'Mochi', stage: 2, form: 'teen.physical', stats: { power: 40, speed: 40, guard: 30, wits: 15 } });
    const r = finishBattle(p, 'won', 5, fought({ foe: strong }));
    expect(r.upset).toBe(true);
    expect(r.gain).toBe(4);
    const q = pet();
    const even = finishBattle(q, 'won', 5, fought());
    expect(even.upset).toBe(false);
    expect(even.gain).toBe(2);
    // Wild creatures don't count: a new pet often meets one with a few points more.
    const wild = finishBattle(pet(), 'won', 5, fought({ foe: { ...strong, wild: true } }));
    expect(wild.upset).toBe(false);
    expect(wild.gain).toBe(2);
  });

  it('gives a loser a little experience and remembers what beat it', () => {
    const p = pet();
    const foe = fought().foe;
    foe.stats.speed = 45;
    const r = finishBattle(p, 'lost', 5, fought({ foe }));
    expect(p.battles).toEqual({ wins: 0, losses: 1 });
    expect(p.mood).toBe(42);
    expect(r.xp).toBe(2);
    expect(r.stat).toBeNull();
    expect(p.lessons).toEqual([{ stat: 'speed', from: 'Mochi' }]);
  });

  it('scales experience by how the fight went, without saying so', () => {
    expect(battleXp(pet(), 'lost', fought({ damageDealt: 0.95 }))).toBe(3);
    expect(battleXp(pet(), 'lost', fought({ damageDealt: 0.05 }))).toBe(1);
    const strong = fought().foe;
    strong.stats = { power: 40, speed: 40, guard: 40, wits: 40 };
    expect(battleXp(pet(), 'won', fought({ foe: strong }))).toBe(6);
    const weak = fought().foe;
    weak.stats = { power: 2, speed: 2, guard: 2, wits: 2 };
    expect(battleXp(pet(), 'won', fought({ foe: weak }))).toBe(2);
  });

  it('pays nothing for running away, giving up, quick losses or early forfeits', () => {
    expect(battleXp(pet(), 'fled', fought())).toBe(0);
    expect(battleXp(pet(), 'lost', fought({ gaveUp: true }))).toBe(0);
    expect(battleXp(pet(), 'lost', fought({ turns: 2, damageDealt: 0.1 }))).toBe(0);
    expect(battleXp(pet(), 'lost', fought({ turns: 2, damageDealt: 0.3 }))).toBeGreaterThan(0);
    expect(battleXp(pet(), 'won', fought({ forfeit: true, turns: 1 }))).toBe(0);
    expect(battleXp(pet(), 'won', fought({ forfeit: true, turns: 3 }))).toBeGreaterThan(0);
    const p = pet();
    finishBattle(p, 'lost', 5, fought({ gaveUp: true }));
    expect(p.lessons).toEqual([]);
  });

  it('turns a full bar into a point in the stat opponents taught most', () => {
    const p = pet();
    p.battleXp = 9;
    p.lessons = [
      { stat: 'guard', from: 'Rock' },
      { stat: 'speed', from: 'Zip' },
      { stat: 'speed', from: 'Mochi' },
    ];
    const r = finishBattle(p, 'lost', 5, fought());
    expect(r.learned).toBe('speed');
    expect(r.teacher).toBe('Mochi');
    expect(p.stats.speed).toBe(21);
    expect(p.battleXp).toBe(1);
    // The lesson that was used is gone; the new one from this loss was added.
    expect(p.lessons.map((l) => l.stat)).toEqual(['guard', 'speed', lessonFrom(p, fought().foe)]);
  });

  it('falls back to a random stat without lessons, and waits when every stat is at its limit', () => {
    const p = pet();
    p.battleXp = 8;
    const r = finishBattle(p, 'won', 5, fought());
    expect(r.learned).not.toBeNull();
    expect(r.teacher).toBeNull();

    const maxed = pet();
    maxed.stats = { power: 60, speed: 60, guard: 60, wits: 60 };
    maxed.battleXp = 8;
    const r2 = finishBattle(maxed, 'won', 5, fought());
    expect(r2.learned).toBeNull();
    expect(maxed.battleXp).toBe(XP_PER_POINT);
  });

  it('gives older pets an empty bar and no lessons', () => {
    const p = pet() as Partial<ReturnType<typeof pet>> & Parameters<typeof migratePet>[0];
    delete p.battleXp;
    delete p.lessons;
    const migrated = migratePet(p);
    expect(migrated.battleXp).toBe(0);
    expect(migrated.lessons).toEqual([]);
  });

  it('builds a fighter from the pet, including its teen path', () => {
    const p = pet();
    p.path = ['baby', 'child.bright', 'teen.technical', 'adult.guard'];
    Object.assign(p, { stage: 3, form: 'adult.guard' });
    expect(movesFor(fighterFromPet(p))).toEqual(['tackle', 'element', 'focus', 'shell']);
  });
});

describe('battle codes', () => {
  it('round-trips a pet, also from a challenge link', () => {
    const f = fighter({ name: 'Mochi ✨', seed: 0xbeef });
    const code = encodeFighter(f);
    expect(code.length).toBeLessThan(40);
    expect(decodeFighter(code)).toEqual(f);
    expect(decodeFighter(`https://example.com/pets/?challenge=${code}`)).toEqual(f);
  });

  it('rejects typos, truncation and impossible pets', () => {
    const code = encodeFighter(fighter());
    const typo = code.slice(0, 5) + (code[5] === 'A' ? 'B' : 'A') + code.slice(6);
    expect(decodeFighter(typo)).toBeNull();
    expect(decodeFighter(code.slice(0, -3))).toBeNull();
    expect(decodeFighter('hello world')).toBeNull();
    expect(decodeFighter(encodeFighter(fighter({ stage: 1, form: 'child.bright', stats: { power: 90, speed: 0, guard: 0, wits: 0 } })))).toBeNull();
  });

  it('drops invisible characters from names and refuses names longer than the game writes', () => {
    expect(decodeFighter(encodeFighter(fighter({ name: '\u202eMochi\u200b\u0007' })))?.name).toBe('Mochi');
    // A hand-made code with a 60-byte name and a correct checksum.
    const body = [...Buffer.from(encodeFighter(fighter({ name: 'x' })), 'base64url')].slice(0, 10);
    body.push(...new TextEncoder().encode('y'.repeat(60)));
    let h = 0x811c9dc5;
    for (const b of body) h = Math.imul(h ^ b, 0x01000193);
    const code = Buffer.from([...body, (h ^ (h >>> 8) ^ (h >>> 16) ^ (h >>> 24)) & 0xff]).toString('base64url');
    expect(decodeFighter(code)).toBeNull();
  });
});
