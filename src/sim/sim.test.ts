import { describe, expect, it } from 'vitest';
import { HOUR } from './clock';
import { careLeaning, comfortEgg, createEgg, eggType, hatchStage, mistEgg, turnEgg, warmEgg } from './egg';
import { advance, DEFAULT_SETTINGS, newGame } from './game';
import type { GameState, NeglectMode } from './types';

// Local-time timestamps, so the sleep window (22:00–07:00) is deterministic.
const at = (day: number, hour: number) => new Date(2026, 0, day, hour, 0).getTime();

function game(neglect: NeglectMode = 'gentle', start = at(1, 9), seed = 42): GameState {
  return newGame(start, { ...DEFAULT_SETTINGS, neglect }, seed);
}

/** Simulate a diligent player who checks in every hour while awake. */
function careFor(
  state: GameState,
  hours: number,
  care: (s: GameState, t: number) => void,
  observe?: (s: GameState) => void,
) {
  const start = state.simTime;
  for (let h = 1; h <= hours && state.phase === 'egg'; h++) {
    const t = start + h * HOUR;
    advance(state, t);
    observe?.(state);
    const hour = new Date(t).getHours();
    if (hour >= 7 && hour < 22) care(state, t);
  }
}

const allRounder = (s: GameState, t: number) => {
  warmEgg(s.egg, 40);
  mistEgg(s.egg, 30);
  comfortEgg(s.egg, 25);
  turnEgg(s.egg, t);
};

describe('hidden hatch time', () => {
  it('rolls a secret duration inside the 20–28h window, fixed per seed', () => {
    const durations = Array.from({ length: 200 }, (_, i) => createEgg(0, i).baseHours);
    expect(Math.min(...durations)).toBeGreaterThanOrEqual(20);
    expect(Math.max(...durations)).toBeLessThanOrEqual(28);
    expect(new Set(durations.map((d) => d.toFixed(2))).size).toBeGreaterThan(100);
    expect(createEgg(0, 7).baseHours).toBe(createEgg(0, 7).baseHours);
  });

  it('jitters stage thresholds so stages do not reveal exact progress', () => {
    const a = createEgg(0, 1).thresholds;
    const b = createEgg(0, 2).thresholds;
    expect(a).not.toEqual(b);
    for (let i = 1; i < a.length; i++) expect(a[i]).toBeGreaterThan(a[i - 1]);
  });

  it('moves through the stages and becomes ready with good care', () => {
    const s = game();
    const seen = new Set<number>();
    careFor(s, 40, allRounder, (st) => seen.add(hatchStage(st.egg)));
    expect(s.egg.readyAt).not.toBeNull();
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
    const hours = (s.egg.readyAt! - at(1, 9)) / HOUR;
    expect(hours).toBeLessThan(s.egg.baseHours);
  });
});

describe('real-time catch-up', () => {
  it('gives the same result in one jump as in many small steps', () => {
    const a = game();
    const b = game();
    advance(a, at(1, 9) + 10 * HOUR);
    for (let i = 1; i <= 600; i++) advance(b, at(1, 9) + i * 60_000);
    expect(a.egg.warmth).toBeCloseTo(b.egg.warmth, 6);
    expect(a.egg.devHours).toBeCloseTo(b.egg.devHours, 6);
    expect(a.egg.health).toBeCloseTo(b.egg.health, 6);
  });

  it('barely drains needs during the sleep window', () => {
    const s = game('gentle', at(1, 22));
    s.egg.lightsOn = false;
    advance(s, at(2, 6));
    expect(s.egg.warmth).toBeGreaterThan(50);
    expect(s.egg.careMistakes).toBe(0);
  });

  it('hatches on its own if nobody comes back long after it is ready', () => {
    const s = game();
    advance(s, at(4, 12));
    expect(s.phase).toBe('hatched');
    expect(s.pet?.hatchedAlone).toBe(true);
    expect(s.pet?.revealSeen).toBe(false);
  });
});

describe('neglect modes', () => {
  it('cozy never loses health', () => {
    const s = game('cozy');
    advance(s, at(2, 9));
    expect(s.egg.health).toBe(100);
  });

  it('gentle keeps a health floor and still hatches', () => {
    const s = game('gentle');
    advance(s, at(3, 9));
    expect(s.egg.failed).toBe(false);
    expect(s.egg.health).toBeGreaterThanOrEqual(10);
    expect(s.egg.readyAt).not.toBeNull();
  });

  it('classic can lose the egg', () => {
    const s = game('classic');
    advance(s, at(3, 9));
    expect(s.egg.failed).toBe(true);
  });
});

describe('element type from care', () => {
  type Need = 'warmth' | 'humidity' | 'bond';
  const give: Record<Need, (s: GameState) => void> = {
    warmth: (s) => warmEgg(s.egg, 22),
    humidity: (s) => mistEgg(s.egg),
    bond: (s) => comfortEgg(s.egg, 25),
  };

  /**
   * A player who checks in every half hour while awake, tops up every need that is below 60, and gives
   * `extra` more of their favorite kinds of care each visit (even when that meter is full).
   */
  function hatchWith(extra: Partial<Record<Need, number>>, seed = 42) {
    const s = game('gentle', at(1, 9), seed);
    for (let i = 1; i <= 120 && s.egg.readyAt === null; i++) {
      const t = at(1, 9) + i * 0.5 * HOUR;
      advance(s, t);
      const h = new Date(t).getHours();
      s.egg.lightsOn = h >= 7 && h < 22;
      if (!s.egg.lightsOn) continue;
      turnEgg(s.egg, t);
      for (const need of ['warmth', 'humidity', 'bond'] as Need[]) {
        while (s.egg[need] < 60) give[need](s);
        for (let n = 0; n < (extra[need] ?? 0); n++) give[need](s);
      }
    }
    return { egg: s.egg, lean: careLeaning(s.egg), type: eggType(s.egg) };
  }

  it('treats plain, even care as neutral, whatever the drain speeds', () => {
    const { lean } = hatchWith({});
    expect(lean.label).toBe('Balanced');
    for (const share of [lean.ember, lean.tide, lean.bloom]) expect(share).toBeCloseTo(1 / 3, 1);
  });

  it('lets an unpampered, balanced egg hatch as any of the three, not always Ember', () => {
    const types = new Set([1, 2, 3, 4, 5, 6].map((seed) => hatchWith({}, seed).type));
    expect(types).toEqual(new Set(['ember', 'tide', 'bloom']));
  });

  it('follows the care the player pampers the egg with', () => {
    expect(hatchWith({ warmth: 2 }).type).toBe('ember');
    expect(hatchWith({ humidity: 2 }).type).toBe('tide');
    expect(hatchWith({ bond: 2 }).type).toBe('bloom');
  });

  it('turns Astral only when all three are pampered evenly on a healthy egg', () => {
    const astral = hatchWith({ warmth: 2, humidity: 1, bond: 2 });
    expect(astral.lean.label).toBe('Balanced');
    expect(astral.type).toBe('astral');
    // Same care, but a weak egg: no Astral.
    astral.egg.health = 50;
    expect(eggType(astral.egg)).not.toBe('astral');
  });

  it('counts pampering only within a budget that refills over time', () => {
    const egg = createEgg(0, 1);
    egg.warmth = 100;
    expect(warmEgg(egg, 50)).toEqual({ added: 0, pampered: 30 });
    expect(warmEgg(egg, 50)).toEqual({ added: 0, pampered: 0 });
    expect(egg.pampered.ember).toBe(30);
  });

  it('rescales care from eggs started under the old rules', async () => {
    const { exportSave, importSave } = await import('./save');
    const s = game();
    const old = JSON.parse(JSON.stringify(s));
    old.egg.care = { ember: 340, tide: 250, bloom: 200 };
    delete old.egg.pampered;
    delete old.egg.pamperBudget;
    const loaded = importSave(exportSave(old));
    expect(loaded.egg.care.ember).toBeCloseTo(loaded.egg.care.tide);
    expect(loaded.egg.care.tide).toBeCloseTo(loaded.egg.care.bloom);
    expect(loaded.egg.pampered).toEqual({ ember: 0, tide: 0, bloom: 0 });
  });
});

