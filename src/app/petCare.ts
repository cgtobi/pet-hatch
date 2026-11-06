/**
 * Caring for the pet: the dock's actions, the round Nap / Wake / Light button, waking it at night, tapping it
 * and the old shell, and what happens to it from moment to moment.
 */
import { haptic, sfx } from '../feedback';
import { t, type TextKey } from '../i18n';
import { dayPart, isAsleep } from '../sim/clock';
import {
  canPlay,
  cleanUp,
  endPowerNap,
  FETCH_THROWS,
  feedPet,
  giveMedicine,
  isSleeping,
  lightSwitched,
  pat,
  playChoice,
  playWith,
  scold,
  startPowerNap,
  TICKLE_LAUGHS,
  wakeAtNight,
  type PlayGame,
} from '../sim/pet';
import type { PetState } from '../sim/types';
import type { TickleSpot } from '../scene/world';
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
  /** A game under way: fetch with the ball ready to throw, or the pet after it; or tickling. */
  playing(): 'throw' | 'fetch' | 'tickle' | null;
  /** A swipe while the ball is ready. */
  throwBall(dx: number, dy: number, ms: number): void;
  /** Rubbing while tickling: where the finger is, and how far it moved (CSS pixels). */
  rub(x: number, y: number, px: number): void;
}

/** A game of fetch ends after this long without a throw. */
const FETCH_IDLE_S = 12;
/** Tickling ends after this long without rubbing. */
const TICKLE_IDLE_S = 10;
/** Rubbing on the ticklish spot this far (CSS pixels, back and forth) makes the pet burst out laughing. */
const TICKLE_FILL_PX = 800;
/** Rubbing the pet elsewhere tickles too, just less. */
const TICKLE_OFF_SPOT = 0.25;
/** How long a laugh lasts; rubbing on through it this far is too much, and the pet wriggles away. */
const LAUGH_S = 1.3;
const TOO_MUCH_PX = 500;
const SPOTS: TickleSpot[] = ['left', 'right', 'top'];

export function createPetCare(g: Game, moments: Pick<Moments, 'evolve' | 'showEnding' | 'endShown' | 'vial'>): PetCare {
  let tapped = false;
  /** A game of fetch: throws so far, balls brought back, and seconds left to throw the next one. */
  let fetch: { throws: number; fetched: number; idle: number } | null = null;
  /**
   * Tickling: the ticklish spot, how full the giggle is (0…1), laughs so far, seconds left without rubbing, the
   * laugh still playing (seconds), rubbing during it, and when the glint and squeak are next due.
   */
  let tickle: {
    spot: TickleSpot;
    fill: number;
    laughs: number;
    idle: number;
    laughing: number;
    pushed: number;
    glint: number;
    squeak: number;
  } | null = null;

  /** Play: lay out the ball. The pet gets its play once the game of fetch ends. */
  function startFetch() {
    if (fetch) return;
    fetch = { throws: 0, fetched: 0, idle: FETCH_IDLE_S };
    g.world.onBall = (result) => {
      if (!fetch) return;
      if (result === 'fetched') {
        fetch.fetched++;
        g.world.effects.emit('heart', g.petCenter(), 3);
        sfx.hit();
        haptic('success');
      } else {
        sfx.miss();
        g.hud.toast(t('toast.ballLost'));
      }
      fetch.idle = FETCH_IDLE_S;
      if (fetch.throws >= FETCH_THROWS) endFetch();
      else g.refresh();
    };
    g.world.playBall();
    sfx.tap();
    g.refresh();
  }

  function throwBall(dx: number, dy: number, ms: number) {
    if (!fetch || !g.world.throwBall(dx / innerWidth, dy / innerHeight, ms)) return;
    fetch.throws++;
    fetch.idle = FETCH_IDLE_S;
    sfx.whoosh();
    haptic('tap');
    g.refresh();
  }

  /** The game of fetch is over: the pet gets its play, more cheerful for each ball it brought back. */
  function endFetch(cancelled = false) {
    const done = fetch;
    fetch = null;
    g.world.endBall();
    g.world.onBall = () => {};
    if (done && !cancelled) finishPlay(done.fetched, false, 'fetch');
    else g.refresh();
  }

  /** Play: the pet wants a tickle. It stands still, and a glint shows where it is ticklish. */
  function startTickle() {
    const pet = g.livePet();
    if (tickle || !pet || !g.world.pet) return;
    const spot = SPOTS[Math.floor(Math.random() * SPOTS.length)];
    tickle = { spot, fill: 0, laughs: 0, idle: TICKLE_IDLE_S, laughing: 0, pushed: 0, glint: 0, squeak: 0 };
    g.world.pet.stay(true);
    g.world.pet.giggle();
    sfx.giggle();
    g.hud.toast(t('toast.tickleWant', { name: pet.name }));
    g.refresh();
  }

  function rub(x: number, y: number, px: number) {
    const view = g.world.pet;
    if (!tickle || !view || px <= 0) return;
    const center = g.world.toScreen(g.petCenter());
    const at = g.world.tickleSpot(tickle.spot);
    const radius = g.world.petRadiusPx();
    const spot = at ? g.world.toScreen(at) : center;
    // A fingertip around the glint counts; a baby on a phone is only about 30 px tall.
    const onSpot = Math.hypot(x - spot.x, y - spot.y) < Math.max(24, radius * 0.8);
    const onPet = onSpot || Math.hypot(x - center.x, y - center.y) < Math.max(40, radius * 1.3);
    if (!onPet) return;
    tickle.idle = TICKLE_IDLE_S;
    if (tickle.laughing > 0) {
      // Still laughing: rubbing on regardless is too much, and it wriggles away (once per laugh).
      if (tickle.pushed >= 0 && (tickle.pushed += px) > TOO_MUCH_PX) {
        tickle.pushed = -1;
        wriggleAway();
      }
      return;
    }
    tickle.fill += (px * (onSpot ? 1 : TICKLE_OFF_SPOT)) / TICKLE_FILL_PX;
    view.giggle();
    if (tickle.squeak <= 0) {
      sfx.giggle();
      tickle.squeak = onSpot ? 0.16 : 0.35;
    }
    if (tickle.fill >= 1) laugh();
  }

  /** The giggle is full: the pet bursts out laughing, and the ticklish spot moves somewhere else. */
  function laugh() {
    if (!tickle || !g.world.pet) return;
    tickle.laughs++;
    tickle.fill = 0;
    tickle.laughing = LAUGH_S;
    tickle.pushed = 0;
    tickle.spot = SPOTS.filter((s) => s !== tickle!.spot)[Math.floor(Math.random() * (SPOTS.length - 1))];
    g.world.pet.laugh();
    g.world.effects.emit('heart', g.petCenter(), 3);
    g.world.effects.emit('note', g.petCenter(), 1);
    sfx.laugh();
    haptic('success');
  }

  /** "Hihi, enough!": the pet scampers a few steps away, and the game goes on there. */
  function wriggleAway() {
    const pet = g.livePet();
    const view = g.world.pet;
    if (!pet || !view) return;
    const pos = view.group.position;
    const a = Math.random() * Math.PI * 2;
    let x = pos.x + Math.cos(a) * 0.7;
    let z = pos.z + Math.sin(a) * 0.7;
    const r = Math.hypot(x, z);
    if (r > 1.3) [x, z] = [(x / r) * 1.3, (z / r) * 1.3];
    view.runTo(x, z, () => {});
    g.hud.toast(t('toast.tickleEnough', { name: pet.name }));
  }

  /** Tickling is over: the pet gets its play, more cheerful for each time it burst out laughing. */
  function endTickle(cancelled = false) {
    const done = tickle;
    tickle = null;
    g.world.pet?.stay(false);
    if (done && !cancelled) finishPlay(done.laughs, false, 'tickle');
    else g.refresh();
  }

  function finishPlay(extra: number, woke: boolean, game: PlayGame) {
    const pet = g.livePet();
    if (!pet) return;
    const r = playWith(pet, g.now(), g.state.settings, extra, game);
    if (r === 'ok') {
      g.world.pet?.dance();
      sfx.play();
      haptic('success');
      for (let i = 0; i < 4; i++) setTimeout(() => g.world.effects.emit(i % 2 ? 'note' : 'heart', g.petCenter(), 1), i * 300);
      if (!woke) {
        const [one, many] = game === 'fetch' ? (['toast.fetchedOne', 'toast.fetched'] as const) : (['toast.giggledOne', 'toast.giggled'] as const);
        const key = extra === 0 ? 'toast.played' : extra === 1 ? one : many;
        g.hud.toast(t(key, { name: pet.name, n: extra }));
      }
    }
    g.save();
    g.refresh();
  }

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
    if (action === 'vial') {
      moments.vial();
      return;
    }
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
          sfx.sweep();
          haptic('tap');
          g.hud.toast(t('toast.cleaned'));
        } else {
          sfx.brush();
          g.hud.toast(t('toast.alreadyClean'));
        }
        break;
      }
      case 'play': {
        if (night === 'asleep' || fetch || tickle) break;
        const r = canPlay(pet, now, g.state.settings);
        if (r !== 'ok') {
          if (night !== 'woke') {
            sfx.nope();
            g.hud.toast(t(r === 'tired' ? 'toast.tired' : 'toast.asleep', name));
          }
        } else if (night === 'woke' || !view) {
          // Woken at night: a quick cuddle, no game.
          finishPlay(0, night === 'woke', playChoice(pet, now));
        } else if (playChoice(pet, now) === 'tickle') startTickle();
        else startFetch();
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

  function tickleFrame(dt: number) {
    if (!tickle) return;
    tickle.squeak -= dt;
    if (tickle.laughing > 0) {
      if ((tickle.laughing -= dt) <= 0 && tickle.laughs >= TICKLE_LAUGHS) return endTickle();
      return;
    }
    if ((tickle.idle -= dt) <= 0) return endTickle();
    // The glint twinkles faster as the giggle fills up.
    if ((tickle.glint -= dt) <= 0) {
      const at = g.world.tickleSpot(tickle.spot);
      if (at) g.world.effects.emit('twinkle', at, tickle.fill > 0.5 ? 2 : 1);
      tickle.glint = 0.3 - tickle.fill * 0.2;
    }
  }

  function frame(dt: number, now: number) {
    const pet = g.state.pet;
    const view = g.world.pet;
    if (fetch) {
      // The game of fetch stops if the pet can't play on (asleep, a sheet opened); it ends with no throw for a while.
      if (!pet || !view || g.sheet.isOpen || isSleeping(pet, now, g.state.settings)) endFetch(true);
      else if (g.world.ballReady && (fetch.idle -= dt) <= 0) endFetch();
    }
    if (tickle) {
      // Tickling stops like fetch; it ends after the last laugh, or with no rubbing for a while.
      if (!pet || !view || g.sheet.isOpen || isSleeping(pet, now, g.state.settings)) endTickle(true);
      else tickleFrame(dt);
    }
    if (g.state.phase !== 'hatched' || !pet || !view) return;
    if (pet.status !== 'alive') {
      if (!moments.endShown() && pet.revealSeen) moments.showEnding(pet);
      return;
    }
    if (pet.fading) {
      // Collapsed: it lies still until the vial is given; training or a battle can't go on.
      if (g.sheet.isOpen) g.sheet.close();
      view.setLook({ sleeping: false, sick: false, calling: false, mood: 0, fading: true });
      return;
    }
    // At day care it isn't on the island; growing up while away plays once it is back.
    view.group.visible = !g.away();
    if (g.away()) {
      if (g.sheet.isOpen) g.sheet.close();
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

  return {
    action: petAction,
    lightButton,
    tap: tapPet,
    sweepShell,
    frame,
    tapped: () => tapped,
    playing: () => (fetch ? (g.world.ballReady ? 'throw' : 'fetch') : tickle ? 'tickle' : null),
    throwBall,
    rub,
  };
}
