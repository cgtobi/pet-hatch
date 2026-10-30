import { describe, expect, it } from 'vitest';
import { HOUR } from '../sim/clock';
import { DEFAULT_SETTINGS, hatch, layNewEgg, newGame } from '../sim/game';
import { isDue, petId, snapshot, today } from './stats';

const T0 = new Date(2026, 0, 1, 9).getTime();

describe('pet stats', () => {
  it('names each egg by its seed and laying time, the same before and after hatching', () => {
    const s = newGame(T0, DEFAULT_SETTINGS, 11);
    const egg = snapshot(s, '0.4.0');
    expect(egg.pet).toMatch(/^[0-9a-f]{14}$/);
    expect(egg).toMatchObject({ phase: 'egg', type: null, form: null, gen: 1, status: 'alive', stars: 0 });
    hatch(s, T0 + 30 * HOUR, false);
    const pet = snapshot(s, '0.4.0');
    expect(pet.pet).toBe(egg.pet);
    expect(pet).toMatchObject({ phase: 'pet', stage: 0, type: s.pet!.type, form: 'baby', mode: 'gentle' });
    layNewEgg(s, T0 + 40 * HOUR, 12);
    expect(snapshot(s, '0.4.0').pet).not.toBe(egg.pet);
    expect(petId(11, T0)).not.toBe(petId(11, T0 + 1));
  });

  it('sends nothing personal: no name, stats or times', () => {
    const s = newGame(T0, DEFAULT_SETTINGS, 11);
    hatch(s, T0 + 30 * HOUR, false);
    s.pet!.name = 'Secretname';
    expect(JSON.stringify(snapshot(s, '0.4.0'))).not.toContain('Secretname');
    expect(Object.keys(snapshot(s, '0.4.0')).sort()).toEqual(
      ['form', 'gen', 'mode', 'pet', 'phase', 'stage', 'stars', 'status', 'type', 'v'].sort(),
    );
  });

  it('reports a lost egg, an ending, or a pet replaced while alive', () => {
    const s = newGame(T0, DEFAULT_SETTINGS, 11);
    s.egg.failed = true;
    expect(snapshot(s, '0.4.0').status).toBe('lost');
    const p = newGame(T0, DEFAULT_SETTINGS, 12);
    hatch(p, T0 + 30 * HOUR, false);
    p.pet!.status = 'ranAway';
    expect(snapshot(p, '0.4.0').status).toBe('ranAway');
    expect(snapshot(p, '0.4.0', 'released').status).toBe('released');
  });

  it('is due once a day, or as soon as anything changes', () => {
    const s = newGame(T0, DEFAULT_SETTINGS, 11);
    const snap = snapshot(s, '0.4.0');
    expect(isDue(undefined, snap, '2026-01-01')).toBe(true);
    const sent = { day: '2026-01-01', key: JSON.stringify(snap) };
    expect(isDue(sent, snap, '2026-01-01')).toBe(false);
    expect(isDue(sent, snap, '2026-01-02')).toBe(true);
    expect(isDue(sent, snapshot(s, '0.4.1'), '2026-01-01')).toBe(true);
    expect(today(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});
