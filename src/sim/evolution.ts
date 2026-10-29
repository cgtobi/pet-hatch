import { FAVORITE, STATS } from './training';
import type { ElementType, FormId, PetState, Stat } from './types';

/** Baby care mistakes up to this count still give the bright child form. */
const BRIGHT_MAX_MISTAKES = 2;

/** Species names are invented proper nouns, the same in every language. */
const SPECIES: Record<ElementType, Record<FormId, string>> = {
  ember: {
    baby: 'Sparkit',
    'child.bright': 'Cindle',
    'child.scruffy': 'Sootling',
    'teen.physical': 'Blazepaw',
    'teen.technical': 'Kilnix',
    'adult.power': 'Pyrollo',
    'adult.speed': 'Flarewing',
    'adult.guard': 'Magmarmor',
    'adult.wits': 'Lumensage',
  },
  tide: {
    baby: 'Dropple',
    'child.bright': 'Splashy',
    'child.scruffy': 'Murklet',
    'teen.physical': 'Surfin',
    'teen.technical': 'Bubblort',
    'adult.power': 'Tsunamaw',
    'adult.speed': 'Rippledart',
    'adult.guard': 'Shellwarden',
    'adult.wits': 'Mistoracle',
  },
  bloom: {
    baby: 'Sproutle',
    'child.bright': 'Petalpip',
    'child.scruffy': 'Thistlet',
    'teen.physical': 'Thornhop',
    'teen.technical': 'Budwick',
    'adult.power': 'Oakrush',
    'adult.speed': 'Zephyrleaf',
    'adult.guard': 'Barkshield',
    'adult.wits': 'Sagebloom',
  },
  astral: {
    baby: 'Twinklet',
    'child.bright': 'Starbit',
    'child.scruffy': 'Dimmet',
    'teen.physical': 'Cometcub',
    'teen.technical': 'Orbix',
    'adult.power': 'Novaram',
    'adult.speed': 'Meteorine',
    'adult.guard': 'Eclipsar',
    'adult.wits': 'Cosmora',
  },
};

export function speciesName(type: ElementType, form: FormId): string {
  return SPECIES[type][form];
}

/** The stat a pet is best at; ties go to its type's favorite, then to the order in STATS. */
export function topStat(pet: PetState): Stat {
  const fav = FAVORITE[pet.type];
  return STATS.reduce((best, s) => {
    const v = pet.stats[s];
    const b = pet.stats[best];
    return v > b || (v === b && s === fav && best !== fav) ? s : best;
  }, fav);
}

/**
 * The form a pet takes on entering a life stage:
 * Child by baby care, Teen by physical (Power + Speed) vs. technical (Guard + Wits) training,
 * Adult by its best stat. Elders keep their adult form.
 */
export function formFor(pet: PetState, stage: number): FormId {
  switch (stage) {
    case 0:
      return 'baby';
    case 1:
      return pet.mistakes[0] <= BRIGHT_MAX_MISTAKES ? 'child.bright' : 'child.scruffy';
    case 2:
      return pet.stats.power + pet.stats.speed >= pet.stats.guard + pet.stats.wits ? 'teen.physical' : 'teen.technical';
    case 3:
      return `adult.${topStat(pet)}`;
    default:
      return pet.form;
  }
}
