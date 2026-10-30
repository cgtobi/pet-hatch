/**
 * Caring for the egg: warming, misting, singing, turning, stroking, the taps that break it open, and how it
 * wobbles and cracks as it grows.
 */
import { haptic, sfx, unlockAudio } from '../feedback';
import { t, type TextKey } from '../i18n';
import { isAsleep } from '../sim/clock';
import { comfortEgg, hatchStage, mistEgg, turnEgg, warmEgg, type CareResult } from '../sim/egg';
import { isReadyToHatch } from '../sim/game';
import type { DockAction } from '../ui/hud';
import type { Rush } from '../ui/status';
import type { Game } from './context';

const WARM_PER_SECOND = 22;
const STROKE_PER_PIXEL = 0.06;
const SING_AMOUNT = 25;
const SING_COOLDOWN = 2.5;
/** Taps it takes to break out of the shell once the egg is ready. */
const RUSH_TAPS = 12;
/** How often (s) and how hard the egg wobbles, by visible stage. */
const WOBBLE = [
  { every: 0, strength: 0 },
  { every: 9, strength: 1.2 },
  { every: 3.5, strength: 2 },
  { every: 1.8, strength: 2.6 },
  { every: 0.8, strength: 3.4 },
];

export interface EggCare {
  action(action: DockAction): void;
  /** Holding (or letting go of) Warm. */
  setWarming(active: boolean): void;
  stroke(px: number): void;
  /** A swipe up mists the egg; a swipe sideways turns it that way. */
  mist(): void;
  turn(direction: 1 | -1): void;
  tap(): void;
  /** Wobbles, cracks and warming over time. */
  frame(dt: number, now: number): void;
  stopWarming(): void;
  /** Taps left to break out, for the hint and the cracks. */
  rush(): Rush;
}

/** @param onHatch called once the last tap breaks the shell */
export function createEggCare(g: Game, onHatch: () => void): EggCare {
  let warming = false;
  let warmFx = 0;
  /** Pampering given during the current hold of Warm, for the toast when it ends. */
  let warmPampered = 0;
  let strokeAcc = 0;
  let singCooldown = 0;
  let wobbleTimer = 2;
  let rushLeft: number | null = null;
  let lastStage = hatchStage(g.state.egg);

  function eggAction(action: DockAction) {
    if (action === 'mist') mist();
    else if (action === 'sing') sing();
    else if (action === 'turn') turn(Math.random() < 0.5 ? 1 : -1);
  }

  function setWarming(active: boolean) {
    unlockAudio();
    if (!g.eggActive()) return;
    if (active && !warming) {
      sfx.warm();
      haptic('tap');
    }
    if (!active && warming) {
      if (warmPampered > 0.5) {
        g.world.effects.emit('heart', g.world.egg.center(), 3);
        g.hud.toast(t('toast.pampered'));
      } else if (g.state.egg.warmth >= 99) g.hud.toast(t('toast.toasty'));
    }
    if (active) warmPampered = 0;
    warming = active;
  }

  /** Care beyond full is pampering: hearts and a toast, so the player learns that it counts. */
  function careFeedback(r: CareResult, raisedKey: TextKey | null) {
    if (r.added > 0) {
      if (raisedKey) g.hud.toast(t(raisedKey));
    } else if (r.pampered > 0) {
      g.world.effects.emit('heart', g.world.egg.center(), 3);
      g.hud.toast(t('toast.pampered'));
    } else g.hud.toast(t('toast.full'));
  }

  function mist() {
    if (!g.eggActive()) return;
    const r = mistEgg(g.state.egg);
    g.world.effects.emit('drop', g.world.egg.center(), 12);
    g.world.egg.nudge(0.8);
    sfx.mist();
    haptic('tap');
    careFeedback(r, 'toast.misted');
  }

  function sing() {
    if (!g.eggActive() || singCooldown > 0) return;
    singCooldown = SING_COOLDOWN;
    const r = comfortEgg(g.state.egg, SING_AMOUNT);
    sfx.sing();
    for (let i = 0; i < 5; i++) {
      setTimeout(() => {
        g.world.effects.emit('note', g.world.egg.center(), 1);
        g.world.egg.nudge(0.7, i % 2 ? 0 : Math.PI);
      }, i * 140);
    }
    careFeedback(r, null);
  }

  function turn(direction: 1 | -1) {
    if (!g.eggActive()) return;
    if (turnEgg(g.state.egg, g.now())) {
      g.world.egg.roll(direction);
      sfx.turn();
      haptic('press');
      g.hud.toast(t('toast.turned'));
    } else {
      g.world.egg.nudge(1, direction > 0 ? 0 : Math.PI);
      sfx.nope();
      g.hud.toast(t('toast.turnedRecently'));
    }
  }

  function stroke(px: number) {
    if (!g.eggActive()) return;
    comfortEgg(g.state.egg, px * STROKE_PER_PIXEL);
    strokeAcc += px;
    if (strokeAcc > 120) {
      strokeAcc = 0;
      g.world.effects.emit('heart', g.world.egg.center(), 1);
      g.world.egg.nudge(0.5);
      haptic('tick');
    }
  }

  function tapEgg() {
    if (!g.eggActive()) return;
    if (rushLeft !== null) {
      rushLeft--;
      g.world.egg.nudge(4);
      g.world.egg.jump(1.6);
      g.world.egg.flashCracks();
      g.world.effects.emit('spark', g.world.egg.center(), 4);
      sfx.crack();
      haptic('press');
      if (rushLeft <= 0) {
        rushLeft = null;
        onHatch();
      }
      g.refresh();
      return;
    }
    comfortEgg(g.state.egg, 2);
    g.world.egg.nudge(1.2);
    g.world.effects.emit('heart', g.world.egg.center(), 1);
    sfx.tap();
  }

  function frame(dt: number, now: number) {
    const egg = g.state.egg;
    singCooldown = Math.max(0, singCooldown - dt);
    if (!g.eggActive()) return;
    if (warming) {
      warmPampered += warmEgg(egg, WARM_PER_SECOND * dt).pampered;
      warmFx -= dt;
      if (warmFx <= 0) {
        warmFx = 0.3;
        g.world.effects.emit('spark', g.world.egg.center(), 1);
      }
    }
    if (isReadyToHatch(g.state) && rushLeft === null && !document.hidden) rushLeft = RUSH_TAPS;

    const stage = hatchStage(egg);
    if (stage > lastStage) {
      sfx.crack();
      g.world.egg.jump(2);
      g.world.egg.flashCracks();
    }
    lastStage = stage;

    const sleepy = isAsleep(now, g.state.settings);
    const w = WOBBLE[stage];
    wobbleTimer -= dt;
    if (w.every > 0 && wobbleTimer <= 0) {
      wobbleTimer = w.every * (0.6 + Math.random() * 0.8) * (sleepy ? 3 : 1);
      g.world.egg.nudge(w.strength * (sleepy ? 0.4 : 1));
      if (stage >= 4) g.world.egg.jump(0.8);
    }
    if (sleepy && Math.random() < dt / 2.5) g.world.effects.emit('zzz', g.world.egg.center(), 1);
  }

  return {
    action: eggAction,
    setWarming,
    stroke,
    mist,
    turn,
    tap: tapEgg,
    frame,
    stopWarming: () => (warming = false),
    rush: () => ({ left: rushLeft, taps: RUSH_TAPS }),
  };
}
