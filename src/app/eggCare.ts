/**
 * Caring for the egg: warming, misting, singing, turning, stroking, knocking back, the taps that break it open,
 * and how it wobbles and cracks as it grows. Firsts earn the egg its stamps.
 */
import { haptic, sfx, unlockAudio } from '../feedback';
import { t, type TextKey } from '../i18n';
import { isAsleep } from '../sim/clock';
import {
  comfortEgg,
  FIRST_STEPS,
  firstStepsDone,
  hatchStage,
  mistEgg,
  stampEgg,
  turnEgg,
  warmEgg,
  type CareResult,
} from '../sim/egg';
import { isReadyToHatch } from '../sim/game';
import {
  ANSWER_GAP,
  ANSWER_WAIT,
  FIRST_KNOCK,
  KNOCK_HOURS,
  KNOCK_STAGE,
  knockDelay,
  knockPattern,
  matchesKnock,
  NEXT_KNOCK,
} from '../sim/knock';
import type { EggStamp } from '../sim/types';
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
  /** The egg is knocking, or waiting for its knock to be answered. */
  knocking(): boolean;
}

/** A knock in progress: when each knock sounds (s from the start), how many have, and the player's answer. */
interface Knock {
  times: number[];
  t: number;
  played: number;
  taps: number[];
}

/** A short pause before the first knock, so it doesn't start mid-gesture. */
const KNOCK_LEAD = 0.3;

/**
 * @param onHatch called once the last tap breaks the shell
 * @param onVial the vial was given to the fading egg
 */
export function createEggCare(g: Game, onHatch: () => void, onVial: () => void): EggCare {
  let warming = false;
  let warmFx = 0;
  /** Pampering given during the current hold of Warm, for the toast when it ends. */
  let warmPampered = 0;
  let strokeAcc = 0;
  let singCooldown = 0;
  let wobbleTimer = 2;
  let rushLeft: number | null = null;
  let lastStage = hatchStage(g.state.egg);
  let knockIn = knockDelay(FIRST_KNOCK, Math.random);

  /**
   * Record a first. On the very first egg, the first steps are a little checklist: each one done gets a chime
   * and a "step done" message (after the care's own message, which it replaces).
   */
  function stamp(s: EggStamp) {
    if (!stampEgg(g.state.egg, s)) return;
    if (g.state.family.length > 0 || !(FIRST_STEPS as readonly EggStamp[]).includes(s)) return;
    const done = firstStepsDone(g.state.egg);
    sfx.knockBack();
    g.hud.toast(
      done < FIRST_STEPS.length ? t('toast.firstStep', { n: done, of: FIRST_STEPS.length }) : t('toast.firstDone'),
    );
    g.save();
    g.refresh();
  }
  let knock: Knock | null = null;

  function startKnock() {
    knock = { times: knockPattern(Math.random), t: 0, played: 0, taps: [] };
    g.refresh();
  }

  function endKnock(answered: boolean) {
    knock = null;
    knockIn = knockDelay(NEXT_KNOCK, Math.random);
    if (answered) {
      // A happy wiggle, and it hatches a little sooner. It's no kind of care, so it leaves the element alone.
      g.state.egg.devHours += KNOCK_HOURS;
      stamp('knock');
      sfx.knockBack();
      haptic('success');
      g.world.egg.jump(1.4);
      g.world.effects.emit('heart', g.world.egg.center(), 4);
      g.hud.toast(t('toast.knockBack'));
    } else g.hud.toast(t('toast.knockMissed'));
    g.save();
    g.refresh();
  }

  /** Knocks sound on time; then the answer is judged once it is complete or the player stops tapping. */
  function knockFrame(dt: number, canKnock: boolean) {
    if (!canKnock) {
      if (knock) {
        knock = null;
        g.refresh();
      }
      return;
    }
    if (!knock) {
      knockIn -= dt;
      if (knockIn <= 0) startKnock();
      return;
    }
    const k = knock;
    k.t += dt;
    while (k.played < k.times.length && k.t >= KNOCK_LEAD + k.times[k.played]) {
      k.played++;
      sfx.knock();
      haptic('tick');
      g.world.egg.nudge(1.8, Math.random() * Math.PI * 2);
    }
    if (k.played < k.times.length) return;
    const last = KNOCK_LEAD + k.times[k.times.length - 1];
    if (k.taps.length === 0) {
      if (k.t > last + ANSWER_WAIT) endKnock(false);
    } else if (k.taps.length >= k.times.length || k.t - k.taps[k.taps.length - 1] > ANSWER_GAP) {
      endKnock(matchesKnock(k.times, k.taps));
    }
  }

  function eggAction(action: DockAction) {
    if (action === 'vial') onVial();
    else if (action === 'mist') mist();
    else if (action === 'sing') sing();
    else if (action === 'turn') turn(Math.random() < 0.5 ? 1 : -1);
  }

  function setWarming(active: boolean) {
    unlockAudio();
    if (!g.eggActive()) return;
    if (active && !warming) {
      sfx.warm();
      haptic('tap');
      stamp('warm');
    }
    if (!active && warming) {
      if (warmPampered > 0.5) {
        g.world.effects.emit('heart', g.world.egg.center(), 3);
        g.hud.toast(t('toast.pampered'));
        stamp('pamper');
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
    // Topping a bar up past full counts as extra care too.
    if (r.pampered > 0) stamp('pamper');
  }

  function mist() {
    if (!g.eggActive()) return;
    const r = mistEgg(g.state.egg);
    g.world.effects.emit('drop', g.world.egg.center(), 12);
    g.world.egg.nudge(0.8);
    sfx.mist();
    haptic('tap');
    careFeedback(r, 'toast.misted');
    stamp('mist');
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
    stamp('sing');
  }

  function turn(direction: 1 | -1) {
    if (!g.eggActive()) return;
    if (turnEgg(g.state.egg, g.now())) {
      g.world.egg.roll(direction);
      sfx.turn();
      haptic('press');
      g.hud.toast(t('toast.turned'));
      stamp('turn');
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
        stamp('hatch');
        onHatch();
      }
      g.refresh();
      return;
    }
    // While it knocks, taps are the answer (once its knocks are done), not comfort.
    if (knock) {
      if (knock.played < knock.times.length) return;
      knock.taps.push(knock.t);
      sfx.knock(true);
      haptic('tick');
      g.world.egg.nudge(0.9);
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
    knockFrame(
      dt,
      stage >= KNOCK_STAGE && !sleepy && !warming && egg.readyAt === null && rushLeft === null && !document.hidden,
    );
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
    knocking: () => knock !== null,
  };
}
