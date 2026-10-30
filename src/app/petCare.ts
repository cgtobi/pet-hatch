/**
 * Caring for the pet: the dock's actions, the round Nap / Wake / Light button, waking it at night, tapping it
 * and the old shell, and what happens to it from moment to moment.
 */
import { haptic, sfx } from '../feedback';
import { t, type TextKey } from '../i18n';
import { dayPart, isAsleep } from '../sim/clock';
import {
  cleanUp,
  endPowerNap,
  feedPet,
  giveMedicine,
  isSleeping,
  lightSwitched,
  pat,
  playWith,
  scold,
  startPowerNap,
  wakeAtNight,
} from '../sim/pet';
import type { PetState } from '../sim/types';
import type { DockAction } from '../ui/hud';
import { lightButtonKind } from '../ui/status';
import type { Game } from './context';
import type { Moments } from './moments';

export interface PetCare {
  action(action: DockAction): void;
  /** Nap or Wake up by day; in the evening and at night, the light. */
  lightButton(): void;
  tap(): void;
  sweepShell(): void;
  /** Its look, wake-ups, and growing up or the end of its story when they come. */
  frame(dt: number, now: number): void;
  /** Whether the player has tapped the pet yet (the hint suggests it until then). */
  tapped(): boolean;
}

export function createPetCare(g: Game, moments: Pick<Moments, 'evolve' | 'showEnding' | 'endShown'>): PetCare {
  let tapped = false;

  /** Nap or Wake up by day; in the evening and at night, the light. */
  function lightButton() {
    const pet = g.livePet();
    if (!pet) return;
    const now = g.now();
    const at = () => g.petCenter();
    let key: TextKey;
    const kind = lightButtonKind(pet, now, g.state.settings);
    if (kind === 'wake') {
      const r = endPowerNap(pet, now);
      key = r === 'grumpy' ? 'toast.wokeGrumpy' : 'toast.wokeEarly';
      if (r === 'grumpy') g.world.pet?.cower();
      sfx.toggle();
    } else if (kind === 'nap') {
      const r = startPowerNap(pet, now, g.state.settings);
      key = r === 'ok' ? 'toast.napStart' : r === 'needsCare' ? 'toast.napNeeds' : r === 'napping' ? 'toast.asleep' : 'toast.notSleepy';
      if (r === 'ok') g.world.effects.emit('zzz', at(), 2);
      else if (r === 'notSleepy') g.world.pet?.hop();
      sfx.tap();
    } else {
      const lit = (g.state.egg.lightsOn = !g.state.egg.lightsOn);
      sfx.toggle();
      const r = lightSwitched(pet, now, g.state.settings, lit);
      if (dayPart(now, g.state.settings) === 'night') key = lit ? 'toast.lightsOnNight' : 'toast.lightsOff';
      else {
        key =
          r === 'dozed'
            ? 'toast.dozedOff'
            : r === 'perked'
              ? 'toast.perkedUp'
              : r === 'restless'
                ? 'toast.napNeeds'
                : lit
                  ? 'toast.lightsOn'
                  : 'toast.lightsOffEvening';
        if (r === 'dozed') g.world.effects.emit('zzz', at(), 2);
        else if (r === 'perked') g.world.pet?.hop();
      }
    }
    g.hud.toast(t(key, { name: pet.name }));
    g.save();
    g.refresh();
  }

  /**
   * At night, Feed, Play and Train wake the pet when the light is on (grumpy, see wakeAtNight); with it off they
   * let it sleep. Returns whether the pet is up for the action, and whether this just woke it.
   */
  function nightWake(pet: PetState, now: number): 'up' | 'woke' | 'asleep' {
    if (!isAsleep(now, g.state.settings) || pet.upLate) return 'up';
    const name = { name: pet.name };
    if (!g.state.egg.lightsOn) {
      // How to wake it is shown once; after that it simply sleeps.
      g.hud.toast(t(g.state.learned?.lightTip ? 'toast.asleep' : 'toast.asleepLightTip', name));
      g.state.learned = { ...g.state.learned, lightTip: true };
      sfx.nope();
      return 'asleep';
    }
    const r = wakeAtNight(pet, now, g.state.settings);
    g.state.learned = { ...g.state.learned, nightWake: true, lightTip: true };
    g.hud.toast(t(r === 'mistake' ? 'toast.wokeAgain' : 'toast.wokeGrumpy', name));
    g.world.pet?.cower();
    return 'woke';
  }

  function petAction(action: DockAction) {
    const pet = g.livePet();
    if (!pet) return;
    const now = g.now();
    const view = g.world.pet;
    const name = { name: pet.name };
    const at = () => view?.center() ?? g.world.egg.center();

    // At night these wake the pet if the light is on; the wake-up message then wins over the action's own.
    const night = action === 'feed' || action === 'play' || action === 'train' ? nightWake(pet, now) : 'up';
    switch (action) {
      case 'train':
        sfx.tap();
        if (night === 'woke') g.save();
        g.sheet.open('train');
        return;
      case 'feed': {
        if (night === 'asleep') break;
        const r = feedPet(pet, now, g.state.settings);
        if (r === 'ok') {
          view?.eat();
          sfx.eat();
          haptic('tap');
          setTimeout(() => g.world.effects.emit('heart', at(), 2), 1300);
          if (night !== 'woke') g.hud.toast(t('toast.fed'));
        } else if (night !== 'woke') {
          sfx.nope();
          g.hud.toast(t(r === 'full' ? 'toast.notHungry' : 'toast.asleep', name));
        }
        break;
      }
      case 'clean': {
        const spots = g.world.droppingPositions();
        if (cleanUp(pet) > 0) {
          for (const p of spots) {
            g.world.effects.emit('spark', p, 6);
            g.world.effects.emit('drop', p.clone().setY(p.y - 1), 4);
          }
          g.world.setDroppings(pet.droppings);
          sfx.mist();
          haptic('tap');
          g.hud.toast(t('toast.cleaned'));
        } else g.hud.toast(t('toast.alreadyClean'));
        break;
      }
      case 'play': {
        if (night === 'asleep') break;
        const r = playWith(pet, now, g.state.settings);
        if (r === 'ok') {
          view?.dance();
          sfx.play();
          haptic('success');
          for (let i = 0; i < 4; i++) setTimeout(() => g.world.effects.emit(i % 2 ? 'note' : 'heart', at(), 1), i * 300);
          if (night !== 'woke') g.hud.toast(t('toast.played'));
        } else if (night !== 'woke') {
          sfx.nope();
          g.hud.toast(t(r === 'tired' ? 'toast.tired' : 'toast.asleep', name));
        }
        break;
      }
      case 'medicine': {
        const r = giveMedicine(pet);
        if (r === 'cured') {
          g.world.effects.emit('spark', at(), 14);
          sfx.cure();
          haptic('success');
        } else if (r === 'dose') {
          g.world.effects.emit('spark', at(), 5);
          sfx.cure();
        } else {
          view?.cower();
          sfx.nope();
        }
        g.hud.toast(t(r === 'cured' ? 'toast.cured' : r === 'dose' ? 'toast.dose' : 'toast.notSick'));
        break;
      }
      case 'scold': {
        const r = scold(pet);
        view?.cower();
        sfx.scold();
        haptic('warn');
        g.hud.toast(t(r === 'disciplined' ? 'toast.disciplined' : r === 'unfair' ? 'toast.unfair' : 'toast.confused', name));
        break;
      }
    }
    g.save();
    g.refresh();
  }

  /** Tapping the old eggshell sweeps it away: it bursts into shards that tumble off and vanish. */
  function sweepShell() {
    const pet = g.livePet();
    if (!pet || pet.shellSwept) return;
    const at = g.world.egg.shellCenter();
    pet.shellSwept = true;
    g.world.updateShell(0, true);
    g.world.effects.shatter(at, 14);
    g.world.effects.emit('spark', at, 8);
    sfx.crack();
    haptic('tap');
    g.hud.toast(t('toast.shellSwept'));
    g.save();
  }

  function tapPet() {
    const pet = g.livePet();
    if (!pet || !g.world.pet) return;
    tapped = true;
    if (isSleeping(pet, g.now(), g.state.settings)) {
      g.world.effects.emit('zzz', g.world.pet.center(), 1);
      return;
    }
    pat(pet);
    g.world.pet.hop();
    g.world.effects.emit('heart', g.world.pet.center(), 2);
    sfx.tap();
    haptic('tap');
  }

  function frame(dt: number, now: number) {
    const pet = g.state.pet;
    const view = g.world.pet;
    if (g.state.phase !== 'hatched' || !pet || !view) return;
    if (pet.status !== 'alive') {
      if (!moments.endShown() && pet.revealSeen) moments.showEnding(pet);
      return;
    }
    if (pet.stage > pet.shownStage && pet.revealSeen && !g.hud.overlayOpen && !g.sheet.isOpen) moments.evolve(pet);
    const sleeping = isSleeping(pet, now, g.state.settings);
    view.setLook({ sleeping, sick: pet.sick, calling: pet.call !== null && !g.sheet.isOpen, mood: pet.mood });
    if (pet.wake) {
      // A power nap ended on its own, or a night in the dark made a good morning.
      const key =
        pet.wake === 'rested'
          ? 'toast.wokeRested'
          : pet.wake === 'morning'
            ? 'toast.wokeMorning'
            : pet.wake === 'backToSleep'
              ? 'toast.backToSleep'
              : 'toast.wokeNeed';
      g.hud.toast(t(key, { name: pet.name }));
      if (pet.wake === 'rested' || pet.wake === 'morning') view.hop();
      sfx.toggle();
      pet.wake = null;
      g.save();
    }
    g.world.setDroppings(pet.droppings);
    if (sleeping && Math.random() < dt / 2) g.world.effects.emit('zzz', view.center(), 1);
  }

  return { action: petAction, lightButton, tap: tapPet, sweepShell, frame, tapped: () => tapped };
}
