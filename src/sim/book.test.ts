import { describe, expect, it } from 'vitest';
import { ALL_SPECIES, discoveredSpecies, markBookShown, newInBook, noteSeen, raisedSpecies } from './book';
import { advance, DEFAULT_SETTINGS, hatch, layNewEgg, newGame } from './game';
import { exportSave, importSave } from './save';

const at = (day: number, hour: number) => new Date(2026, 0, day, hour, 0).getTime();

function withPet() {
  const s = newGame(at(1, 9), { ...DEFAULT_SETTINGS, neglect: 'cozy' }, 42);
  advance(s, at(1, 18));
  hatch(s, at(1, 18), false);
  return s;
}

describe('species book', () => {
  it('has all 36 species', () => {
    expect(ALL_SPECIES).toHaveLength(36);
    expect(new Set(ALL_SPECIES).size).toBe(36);
  });

  it('counts the current pet’s forms as raised, and keeps them when its story ends', () => {
    const s = withPet();
    const type = s.pet!.type;
    s.pet!.path = ['baby', 'child.bright'];
    expect([...raisedSpecies(s)].sort()).toEqual([`${type}.baby`, `${type}.child.bright`]);
    layNewEgg(s, at(2, 9));
    expect(s.pet).toBeNull();
    expect(raisedSpecies(s).has(`${type}.child.bright`)).toBe(true);
  });

  it('adds species met in battle once, and says when one is new', () => {
    const s = withPet();
    const own = s.pet!.type;
    expect(noteSeen(s, own, 'baby')).toBe(false);
    expect(noteSeen(s, own === 'tide' ? 'ember' : 'tide', 'adult.guard')).toBe(true);
    expect(noteSeen(s, own === 'tide' ? 'ember' : 'tide', 'adult.guard')).toBe(false);
    expect(discoveredSpecies(s).size).toBe(2);
  });

  it('points out discoveries until the book is opened', () => {
    const s = withPet();
    expect(newInBook(s)).toHaveLength(1);
    markBookShown(s);
    expect(newInBook(s)).toHaveLength(0);
    noteSeen(s, 'astral', 'adult.wits');
    expect(newInBook(s)).toEqual(['astral.adult.wits']);
  });

  it('starts older saves from the family list, and survives a save code', () => {
    const s = withPet();
    s.family.push({ name: 'Old', type: 'bloom', form: 'adult.guard', generation: 1, ending: 'retired', wins: 0, hatchedAt: 0, endedAt: 0 });
    delete s.book;
    expect(raisedSpecies(s).has('bloom.adult.guard')).toBe(true);
    expect(raisedSpecies(s).has('bloom.baby')).toBe(true);
    noteSeen(s, 'tide', 'teen.technical');
    const loaded = importSave(exportSave(s));
    expect(loaded.book?.seen).toEqual(['tide.teen.technical']);
    const bad = JSON.parse(JSON.stringify(s));
    bad.book.seen = ['tide.dragon'];
    expect(() => importSave(exportSave(bad))).toThrow();
  });
});
