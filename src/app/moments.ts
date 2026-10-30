/**
 * The big moments of a pet's story: hatching and naming it, growing up and evolving, how its story ends, and
 * starting a new egg (with the choice of how forgiving the game is).
 */
import { haptic, sfx } from '../feedback';
import { listOf, t } from '../i18n';
import type { PetEnding } from '../net/stats';
import { cleanName } from '../sim/battlecode';
import { speciesName } from '../sim/evolution';
import { hatch, heritageOf, layNewEgg, NEGLECT_MODES } from '../sim/game';
import { LIFE_STAGES } from '../sim/pet';
import type { FormId, NeglectMode, PetState, Stat } from '../sim/types';
import type { Game } from './context';

export interface Moments {
  /** The last tap broke the shell. */
  hatchNow(): void;
  /** The pet bursts out (also when it hatched on its own while nobody looked), then gets its name. */
  burstAndReveal(pet: PetState, alone: boolean): void;
  evolve(pet: PetState): void;
  showEnding(pet: PetState): void;
  eggFailed(): void;
  chooseNeglect(
    title: string,
    body: string,
    then: (mode: NeglectMode, checked: boolean) => void,
    check?: { label: string; checked: boolean },
  ): void;
  startNewEgg(): void;
  /** The story's end (or a lost egg) is on screen. */
  endShown(): boolean;
}

export function createMoments(g: Game, deps: { reportStats(status?: PetEnding): void; stopWarming(): void }): Moments {
  let endShown = false;

  function hatchNow() {
    const pet = hatch(g.state, g.now(), false);
    burstAndReveal(pet, false);
  }

  /** The egg was lost (Classic mode): say so, and offer a new one. */
  function eggFailed() {
    endShown = true;
    deps.reportStats();
    g.refresh();
    g.hud.showOverlay({ title: t('failed.title'), body: t('failed.body'), button: t('failed.button'), onClose: startNewEgg });
  }

  function burstAndReveal(pet: PetState, alone: boolean) {
    g.world.effects.shatter(g.world.egg.center());
    g.world.effects.emit('spark', g.world.egg.center(), 18);
    g.world.showPet(pet.type, pet.seed, pet.shownStage, pet.shownForm, true);
    sfx.hatch();
    haptic('hatch');
    g.save();
    g.refresh();
    setTimeout(() => {
      const type = t(`type.${pet.type}`);
      const h = g.state.egg.heritage;
      const body =
        (alone ? `${t('reveal.alone')} ` : '') +
        t(`reveal.body.${pet.type}`) +
        (h
          ? ` ${t('reveal.heritage', {
              parent: h.parentName,
              stats: listOf(Object.entries(h.stats).map(([s, n]) => `${t(`stat.${s as Stat}`)} +${n}`)),
            })}`
          : '');
      g.hud.showOverlay({
        title: t('reveal.title', { type }),
        body,
        button: t('reveal.button'),
        onClose: (name) => {
          if (cleanName(name)) pet.name = cleanName(name);
          pet.revealSeen = true;
          g.save();
          g.refresh();
        },
        field: { label: t('reveal.nameLabel'), value: pet.name },
      });
    }, 1100);
  }

  /** Play a stage change the player hasn't seen yet: grow, and if the form changed, explain the evolution. */
  function evolve(pet: PetState) {
    const evolved = pet.form !== pet.shownForm;
    const stage = Math.min(pet.stage, LIFE_STAGES.length - 1);
    pet.shownStage = pet.stage;
    pet.shownForm = pet.form;
    g.save();
    g.world.pet?.setForm(pet.form, stage, true);
    g.world.effects.emit('spark', g.petCenter(), 24);
    sfx.grow();
    haptic('celebrate');
    const name = pet.name;
    if (!evolved) {
      g.hud.toast(t('toast.grew', { name, stage: t(`life.${LIFE_STAGES[stage]}`) }));
      return;
    }
    const species = speciesName(pet.type, pet.form);
    const why = pet.form.startsWith('adult.')
      ? t('evolve.why.adult', { stat: t(`stat.${pet.form.slice('adult.'.length) as Stat}`) })
      : pet.form !== 'baby'
        ? t(`evolve.why.${pet.form as Exclude<FormId, 'baby' | `adult.${string}`>}`)
        : '';
    setTimeout(
      () =>
        g.hud.showOverlay({
          title: t('evolve.title', { name }),
          body: `${t('evolve.body', { name, species })} ${why}`,
          button: t('evolve.button'),
          onClose: () => g.refresh(),
        }),
      1900,
    );
  }

  function showEnding(pet: PetState) {
    endShown = true;
    deps.reportStats();
    deps.stopWarming();
    g.sheet.close();
    const name = { name: pet.name };
    if (pet.status === 'retired') {
      g.world.pet?.dance();
      g.world.effects.emit('spark', g.petCenter(), 30);
      sfx.grow();
    }
    const key = pet.status === 'ranAway' ? 'ranAway' : pet.status === 'died' ? 'died' : 'retired';
    if (key !== 'retired' && g.world.pet) {
      g.world.effects.emit('spark', g.world.pet.center(), 12);
      g.world.scene.remove(g.world.pet.group);
    }
    g.hud.setMode('none');
    g.hud.setHint('');
    setTimeout(
      () =>
        g.hud.showOverlay({
          title: t(`end.${key}.title`, name),
          body:
            t(`end.${key}.body`) +
            (key === 'retired'
              ? ` ${t('end.retired.heritage', {
                  name: pet.name,
                  stats: listOf(Object.keys(heritageOf(pet).stats).map((s) => t(`stat.${s as Stat}`))),
                })}`
              : ''),
          button: t(key === 'retired' ? 'end.retired.button' : 'failed.button'),
          onClose: startNewEgg,
        }),
      pet.status === 'retired' ? 1600 : 400,
    );
  }

  /** Every egg starts with choosing how forgiving the game is; it stays fixed until the next egg. */
  function chooseNeglect(
    title: string,
    body: string,
    then: (mode: NeglectMode, checked: boolean) => void,
    check?: { label: string; checked: boolean },
  ): void {
    g.hud.showOverlay({
      title,
      body,
      button: t('newEgg.start'),
      onClose: (mode, checked) => then(mode as NeglectMode, checked),
      choices: {
        options: NEGLECT_MODES.map((mode) => ({ value: mode, label: t(`neglect.${mode}`) })),
        value: g.state.settings.neglect,
      },
      check,
    });
  }

  function startNewEgg() {
    // The current egg or pet's story ends here: it was replaced while still alive, or it already ended.
    const alive = g.state.phase === 'egg' ? !g.state.egg.failed : g.state.pet?.status === 'alive';
    deps.reportStats(alive ? 'released' : undefined);
    chooseNeglect(t('newEgg.title'), t('newEgg.body'), (mode) => {
      layNewEgg(g.state, g.now(), undefined, mode);
      g.save();
      location.reload();
    });
  }

  return {
    hatchNow,
    burstAndReveal,
    evolve,
    showEnding,
    eggFailed,
    chooseNeglect,
    startNewEgg,
    endShown: () => endShown,
  };
}
