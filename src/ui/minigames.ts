import type { TrainStat } from '../sim/training';
import type { ElementType } from '../sim/types';
import { icon, type IconName } from './icons';

/** What a minigame reports while it runs; the pet reacts to hits and misses. */
export interface GameHooks {
  hit(): void;
  miss(): void;
  progress(fraction: number): void;
  /** A short status line, e.g. the current round. */
  status(text: string): void;
}

export interface Minigame {
  /** Resolves with a score from 0 to 1 once the game ends on its own. */
  done: Promise<number>;
  stop(): void;
}

export interface GameText {
  round(n: number, of: number): string;
  ready: string;
  tap: string;
  watch: string;
  yourTurn: string;
  /** Smash's twists: its golden round and its surges. */
  golden: string;
  surge: string;
}

/**
 * How a game is set up for this pet: `level` is how hard to play, 0 … 1, from its stat and life stage (see
 * trainLevel); `stage` unlocks twists as it grows up; `type` gives the game its element's look.
 */
export interface GameSetup {
  level: number;
  stage: number;
  type: ElementType;
}

/** Each element's icon on its games' buttons. */
const ELEMENT_ICON: Record<ElementType, IconName> = { ember: 'flame', tide: 'drop', bloom: 'leaf', astral: 'star' };

type Factory = (area: HTMLElement, hooks: GameHooks, text: GameText, setup: GameSetup) => Minigame;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const el = (cls: string, html = '') => Object.assign(document.createElement('div'), { className: cls, innerHTML: html });

/** requestAnimationFrame loop until `step` returns false or the game is stopped. */
function runLoop(step: (dt: number) => boolean): () => void {
  let last = performance.now();
  let id = 0;
  let stopped = false;
  const frame = (ms: number) => {
    if (stopped) return;
    const dt = Math.min(0.1, (ms - last) / 1000);
    last = ms;
    if (step(dt)) id = requestAnimationFrame(frame);
  };
  id = requestAnimationFrame(frame);
  return () => {
    stopped = true;
    cancelAnimationFrame(id);
  };
}

function game(area: HTMLElement, body: (finish: (score: number) => void) => () => void): Minigame {
  let resolve!: (score: number) => void;
  const done = new Promise<number>((r) => (resolve = r));
  let finished = false;
  let cleanup: () => void = () => {};
  const finish = (score: number) => {
    if (finished) return;
    finished = true;
    cleanup();
    resolve(clamp01(score));
  };
  cleanup = body(finish);
  return {
    done,
    stop: () => {
      finished = true;
      cleanup();
      area.replaceChildren();
    },
  };
}

/**
 * Power: mash to fill the meter before each round's time runs out. It drains faster as each round goes on, and
 * the stronger the pet. From
 * teen on, one round is golden: filling it adds a bonus that can make up for a weaker round. From adult on, each
 * round has a surge, a short glow at a random moment when every tap counts triple.
 */
const smash: Factory = (area, hooks, text, { level, stage, type }) =>
  game(area, (finish) => {
    const ROUNDS = 3;
    const ROUND_S = 4;
    // Tuned so steady tapping scores like a good Block or Recall; only fast tapping fills the last round.
    const PER_TAP = 6;
    /**
     * Average drain per second, by round, for the weakest and the strongest pet: filling the meter takes about
     * 5.7, 6.5 and 7.5 taps a second at first, 7, 8.5 and 10 at the top. Within a round the drain builds from 60% to
     * 140% of that, so each round gets tougher as it goes.
     */
    const DRAIN_LOW = [9, 14, 20];
    const DRAIN_HIGH = [17, 26, 35];
    const drain = (r: number, at: number) =>
      (DRAIN_LOW[r] + (DRAIN_HIGH[r] - DRAIN_LOW[r]) * level) * (0.6 + 0.8 * clamp01(at / ROUND_S));
    /** Filling the golden round adds this to the score (a full round counts 1). */
    const GOLDEN_BONUS = 0.5;
    const SURGE_S = 0.8;
    const SURGE_TAP = 3;
    const golden = stage >= 2 ? Math.floor(Math.random() * ROUNDS) : -1;
    const surgeAt = () => (stage >= 3 ? 0.6 + Math.random() * (ROUND_S - SURGE_S - 1) : Infinity);
    const meter = el('mg-meter', '<div class="mg-meter-fill"></div><div class="mg-meter-goal"></div>');
    const fillEl = meter.firstElementChild as HTMLElement;
    const button = Object.assign(document.createElement('button'), {
      type: 'button',
      className: 'mg-smash',
      innerHTML: `${icon(ELEMENT_ICON[type], 40)}<span>${text.tap}</span>`,
    });
    area.classList.add(`el-${type}`);
    area.replaceChildren(meter, button);

    let round = 0;
    let t = -0.8;
    let fill = 0;
    let best = 0;
    let bonus = 0;
    let surge = surgeAt();
    const scores: number[] = [];
    const inSurge = () => t >= surge && t < surge + SURGE_S;
    const status = () =>
      hooks.status(
        [text.round(round + 1, ROUNDS), round === golden ? text.golden : '', inSurge() ? text.surge : '']
          .filter(Boolean)
          .join(' · '),
      );
    status();
    const onTap = (e: PointerEvent) => {
      e.preventDefault();
      if (t < 0) return;
      fill = Math.min(100, fill + PER_TAP * (inSurge() ? SURGE_TAP : 1));
      button.classList.remove('bump');
      void button.offsetWidth;
      button.classList.add('bump');
      if (fill >= 100 && best < 100) hooks.hit();
      best = Math.max(best, fill);
    };
    button.addEventListener('pointerdown', onTap);
    let surging = false;
    const stopLoop = runLoop((dt) => {
      t += dt;
      if (t >= 0) fill = Math.max(0, fill - drain(round, t) * dt);
      fillEl.style.height = `${fill}%`;
      meter.classList.toggle('full', best >= 100);
      meter.classList.toggle('golden', round === golden);
      if (inSurge() !== surging) {
        surging = inSurge();
        button.classList.toggle('surge', surging);
        status();
      }
      button.disabled = t < 0;
      hooks.progress((round + clamp01(t / ROUND_S)) / ROUNDS);
      if (t >= ROUND_S) {
        scores.push(best / 100);
        if (round === golden && best >= 100) bonus += GOLDEN_BONUS;
        if (best < 100) hooks.miss();
        round++;
        if (round >= ROUNDS) {
          finish((scores.reduce((a, b) => a + b, 0) + bonus) / ROUNDS);
          return false;
        }
        t = -0.8;
        fill = 0;
        best = 0;
        surge = surgeAt();
        status();
      }
      return true;
    });
    return () => {
      stopLoop();
      button.removeEventListener('pointerdown', onTap);
    };
  });

/**
 * Speed: tap the stars before they fade (sparks, bubbles, petals or stars, by element). They come faster and fade
 * sooner as the game goes on, and the stronger the pet. From teen on, some are golden: worth double, but quick to
 * fade. From adult on, some are dark: leave them alone, tapping one costs a catch.
 */
const catchStars: Factory = (area, hooks, _text, { level, stage, type }) =>
  game(area, (finish) => {
    const DURATION = 20;
    /** Seconds between stars and how long each lasts, at the start and the end of a game, weakest pet → strongest. */
    const lerp = (a: number, b: number) => a + (b - a) * level;
    // The same start as before, but twice as fast by the end of a session.
    const SPAWN = [lerp(0.85, 0.7), lerp(0.45, 0.33)];
    const LIFE = [lerp(1.4, 1.1), lerp(0.7, 0.5)];
    const GOLDEN = stage >= 2 ? 0.14 : 0;
    const DARK = stage >= 3 ? 0.16 : 0;
    area.classList.add(`el-${type}`);
    area.replaceChildren();
    let t = 0;
    let nextSpawn = 0.6;
    /** Stars there were to catch (dark ones don't count), and the catches, golden ones counting double. */
    let spawned = 0;
    let points = 0;
    const live = new Set<{ node: HTMLButtonElement; age: number; life: number; dark: boolean }>();
    hooks.status('0');
    const stopLoop = runLoop((dt) => {
      t += dt;
      const p = clamp01(t / DURATION);
      hooks.progress(p);
      nextSpawn -= dt;
      if (nextSpawn <= 0 && t < DURATION - 0.5) {
        nextSpawn = SPAWN[0] + (SPAWN[1] - SPAWN[0]) * p;
        const roll = Math.random();
        const kind = roll < GOLDEN ? 'golden' : roll < GOLDEN + DARK ? 'dark' : '';
        if (kind !== 'dark') spawned++;
        const node = Object.assign(document.createElement('button'), {
          type: 'button',
          className: `mg-star ${kind}`,
          innerHTML: icon(kind === 'golden' ? 'star' : ELEMENT_ICON[type], 30),
        });
        node.style.left = `${8 + Math.random() * 76}%`;
        node.style.top = `${8 + Math.random() * 72}%`;
        const life = (LIFE[0] + (LIFE[1] - LIFE[0]) * p) * (kind === 'golden' ? 0.7 : 1);
        const star = { node, age: 0, life, dark: kind === 'dark' };
        node.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          if (!live.has(star)) return;
          live.delete(star);
          if (star.dark) {
            points -= 1;
            hooks.miss();
            node.classList.add('popped');
          } else {
            points += kind === 'golden' ? 2 : 1;
            hooks.hit();
            node.classList.add('caught');
          }
          hooks.status(String(Math.max(0, points)));
          setTimeout(() => node.remove(), 250);
        });
        live.add(star);
        area.append(node);
      }
      for (const s of live) {
        s.age += dt;
        s.node.style.opacity = String(1 - Math.max(0, (s.age / s.life - 0.6) / 0.4));
        if (s.age >= s.life) {
          live.delete(s);
          s.node.remove();
          // Letting a dark star fade is right.
          if (!s.dark) hooks.miss();
        }
      }
      if (t >= DURATION && live.size === 0) {
        finish(spawned ? Math.max(0, points) / (spawned * 0.85) : 0);
        return false;
      }
      return true;
    });
    return stopLoop;
  });

/**
 * Guard: tap the side an attack comes from just before it lands. The stronger the pet, the faster it starts; it
 * speeds up through the game and with each block.
 */
const block: Factory = (area, hooks, text, { level, type }) =>
  game(area, (finish) => {
    const ATTACKS = 12;
    const ZONE: [number, number] = [0.55, 0.95];
    /** Each successful block makes the following attacks this much faster. */
    const SPEEDUP = 1.04;
    /** Seconds an attack takes to land, and between attacks, at the start: weakest pet → strongest. */
    const TRAVEL = 1.9 - 0.4 * level;
    const GAP = 1.5 - 0.3 * level;
    area.classList.add(`el-${type}`);
    const colors = ['var(--ember)', 'var(--tide)', 'var(--bloom)'];
    const core = el('mg-core', icon('shield', 34));
    const shields = { left: el('mg-shield left'), right: el('mg-shield right') };
    const lanes = { left: el('mg-lane left'), right: el('mg-lane right') };
    const hint = el('mg-block-hint', `<span>◀ ${text.tap}</span><span>${text.tap} ▶</span>`);
    area.replaceChildren(lanes.left, lanes.right, shields.left, shields.right, core, hint);

    type Side = 'left' | 'right';
    const shots: { side: Side; node: HTMLElement; p: number; travel: number }[] = [];
    const cooldown = { left: 0, right: 0 };
    let launched = 0;
    let blocked = 0;
    let nextShot = 0.8;
    hooks.status(`0 / ${ATTACKS}`);

    const onTap = (e: PointerEvent) => {
      e.preventDefault();
      const rect = area.getBoundingClientRect();
      const side: Side = e.clientX < rect.left + rect.width / 2 ? 'left' : 'right';
      if (cooldown[side] > 0) return;
      const shield = shields[side];
      shield.classList.remove('up');
      void shield.offsetWidth;
      shield.classList.add('up');
      const target = shots.find((s) => s.side === side && s.p >= ZONE[0] && s.p <= ZONE[1]);
      if (target) {
        shots.splice(shots.indexOf(target), 1);
        target.node.classList.add('blocked');
        setTimeout(() => target.node.remove(), 300);
        blocked++;
        hooks.status(`${blocked} / ${ATTACKS}`);
        hooks.hit();
      } else {
        // Swinging at nothing leaves that side open for a moment, so mashing doesn't work.
        cooldown[side] = 0.45;
      }
    };
    area.addEventListener('pointerdown', onTap);

    const stopLoop = runLoop((dt) => {
      cooldown.left = Math.max(0, cooldown.left - dt);
      cooldown.right = Math.max(0, cooldown.right - dt);
      shields.left.classList.toggle('cool', cooldown.left > 0);
      shields.right.classList.toggle('cool', cooldown.right > 0);
      nextShot -= dt;
      if (nextShot <= 0 && launched < ATTACKS) {
        const k = launched / ATTACKS;
        const pace = SPEEDUP ** blocked;
        const side: Side = Math.random() < 0.5 ? 'left' : 'right';
        const node = el(`mg-shot ${side}`);
        node.style.background = colors[launched % colors.length];
        lanes[side].append(node);
        shots.push({ side, node, p: 0, travel: (TRAVEL * (1 - 0.42 * k)) / pace });
        launched++;
        nextShot = (GAP * (1 - 0.4 * k) + Math.random() * 0.3) / pace;
      }
      for (const s of [...shots]) {
        s.p += dt / s.travel;
        s.node.style.setProperty('--p', String(Math.min(1, s.p)));
        s.node.classList.toggle('in-zone', s.p >= ZONE[0] && s.p <= ZONE[1]);
        if (s.p >= 1) {
          shots.splice(shots.indexOf(s), 1);
          s.node.classList.add('landed');
          setTimeout(() => s.node.remove(), 300);
          core.classList.remove('ouch');
          void core.offsetWidth;
          core.classList.add('ouch');
          hooks.miss();
        }
      }
      hooks.progress((launched - shots.length) / ATTACKS);
      if (launched >= ATTACKS && shots.length === 0) {
        finish(blocked / ATTACKS);
        return false;
      }
      return true;
    });
    return () => {
      stopLoop();
      area.removeEventListener('pointerdown', onTap);
    };
  });

/**
 * Wits: repeat a growing sequence of pads. The stronger the pet, the longer the first pattern (3 pads, up to 6)
 * and the less time to tap the whole answer (a countdown bar shows it; running out ends the game like a wrong
 * tap). Every pattern grows by one pad a round, for six rounds, and plays a little faster each round.
 */
const recall: Factory = (area, hooks, text, { level }) =>
  game(area, (finish) => {
    const FIRST = 3 + Math.round(3 * level);
    const ROUNDS = 6;
    const LAST = FIRST + ROUNDS - 1;
    /**
     * The pattern plays faster the higher the pet's Wits and life stage (one pad per 600 ms down to 320 ms), and
     * 5% faster each round, so the last round of a game is a quarter faster than the first.
     */
    const STEP = 600 - 280 * level;
    const FLASH = 420 - 190 * level;
    const ROUND_SPEEDUP = 0.05;
    /**
     * Seconds to tap the whole answer: 2 to get going, plus this per pad (1.4 at first, 0.6 at the top), so a
     * new pet has about 6 s for its first pattern and the strongest under 9 s for its last (11 pads).
     */
    const PER_PAD = 1.4 - 0.8 * level;
    const pads: { icon: IconName; tone: string }[] = [
      { icon: 'flame', tone: 'ember-btn' },
      { icon: 'drop', tone: 'tide-btn' },
      { icon: 'leaf', tone: 'bloom-btn' },
      { icon: 'star', tone: 'violet-btn' },
    ];
    const grid = el('mg-pads');
    const buttons = pads.map((p) => {
      const b = Object.assign(document.createElement('button'), {
        type: 'button',
        className: `mg-pad ${p.tone}`,
        innerHTML: icon(p.icon, 36),
      });
      grid.append(b);
      return b;
    });
    const timer = el('mg-timer', '<div></div>');
    const timerFill = timer.firstElementChild as HTMLElement;
    area.replaceChildren(grid, timer);

    const seq: number[] = [];
    let input = 0;
    let listening = false;
    /** Seconds left to finish the answer, and how long it had. */
    let left = 0;
    let allowed = 1;
    let timers: number[] = [];
    const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
    const flash = (i: number, ms: number) => {
      buttons[i].classList.add('lit');
      later(ms, () => buttons[i].classList.remove('lit'));
    };
    const setTimer = (s: number) => {
      left = allowed = s;
    };

    const nextRound = () => {
      do seq.push(Math.floor(Math.random() * pads.length));
      while (seq.length < FIRST);
      listening = false;
      input = 0;
      timer.classList.remove('out');
      hooks.status(text.watch);
      grid.classList.add('watching');
      const speed = 1 - ROUND_SPEEDUP * (seq.length - FIRST);
      seq.forEach((pad, i) => later(500 + i * STEP * speed, () => flash(pad, FLASH * speed)));
      later(500 + seq.length * STEP * speed, () => {
        listening = true;
        setTimer(2 + PER_PAD * seq.length);
        grid.classList.remove('watching');
        hooks.status(text.yourTurn);
      });
    };

    const fail = () => {
      listening = false;
      hooks.miss();
      later(700, () => finish((seq.length - FIRST) / ROUNDS));
    };

    const onPad = (i: number) => (e: PointerEvent) => {
      e.preventDefault();
      if (!listening) return;
      flash(i, 200);
      if (i !== seq[input]) {
        buttons[i].classList.add('wrong');
        fail();
        return;
      }
      input++;
      if (input < seq.length) return;
      listening = false;
      const completed = seq.length - FIRST + 1;
      hooks.hit();
      hooks.progress(completed / ROUNDS);
      if (seq.length >= LAST) later(500, () => finish(1));
      else later(400, nextRound);
    };
    const listeners = buttons.map((b, i) => {
      const fn = onPad(i);
      b.addEventListener('pointerdown', fn);
      return fn;
    });
    const stopLoop = runLoop((dt) => {
      if (listening) {
        left -= dt;
        if (left <= 0) {
          timer.classList.add('out');
          fail();
        }
      }
      timerFill.style.width = `${listening ? Math.max(0, (100 * left) / allowed) : 0}%`;
      return true;
    });
    hooks.progress(0);
    nextRound();
    return () => {
      stopLoop();
      timers.forEach(clearTimeout);
      timers = [];
      buttons.forEach((b, i) => b.removeEventListener('pointerdown', listeners[i]));
    };
  });

/**
 * Endurance: jump the rope in rhythm. A jump clears the rope if the pet is in the air when the rope passes under
 * it, so the right moment is just before the rope reaches the ground; it turns faster and faster.
 * A jump keeps the pet in the air for a moment, and jumping off the beat costs points, so mashing doesn't pay.
 */
const jumpRope: Factory = (area, hooks, text) =>
  game(area, (finish) => {
    const JUMPS = 28;
    /** Practice turns before the counted ones, to catch the rhythm. */
    const LEAD = 2;
    /** Seconds per turn of the rope: the first counted jump, and the last. */
    const SLOW = 0.95;
    const FAST = 0.42;
    const FEET = 112;
    const period = (i: number) => SLOW + (FAST - SLOW) * clamp01((i - LEAD) / (JUMPS - 1));
    /** What a jump off the beat costs, against 1 for a clean jump. */
    const WASTED = 0.25;
    /** How long a jump keeps the pet in the air, by the speed of turn i. */
    const air = (i: number) => Math.min(0.45, Math.max(0.28, 0.6 * period(i)));
    /** A jump clears the rope from this long before it reaches the ground (the pet still well up as it passes)… */
    const before = (i: number) => 0.75 * air(i);
    /** …to this long after, a grace for touch delay. */
    const AFTER = 0.06;
    /** Full marks when the rope passes the pet around the top of its jump. */
    const perfect = (i: number, early: number) => Math.abs(early - air(i) / 2) <= air(i) / 4;
    // When the rope passes under the feet; it starts turning one slow turn before the first.
    const beats: number[] = [];
    for (let i = 0, at = 1.2; i < LEAD + JUMPS; at += period(i), i++) beats.push(at);
    const judged = beats.map(() => false);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 200 150');
    svg.classList.add('mg-rope');
    svg.innerHTML = `<line class="mg-rope-ground" x1="20" y1="141" x2="180" y2="141"/>
      <ellipse class="mg-rope-cue" cx="100" cy="141" rx="28" ry="5"/>
      <path class="mg-rope-line back"/>
      <ellipse class="mg-rope-shadow" cx="100" cy="141" rx="16" ry="3.5"/>
      <g class="mg-rope-jumper"><circle r="18"/><g transform="translate(-11 -11)">${icon('bolt', 22)}</g></g>
      <path class="mg-rope-line front"/>
      <circle class="mg-rope-hand" cx="30" cy="70" r="5"/><circle class="mg-rope-hand" cx="170" cy="70" r="5"/>`;
    const [back, front] = svg.querySelectorAll<SVGPathElement>('.mg-rope-line');
    const jumper = svg.querySelector<SVGGElement>('.mg-rope-jumper')!;
    const shadow = svg.querySelector<SVGEllipseElement>('.mg-rope-shadow')!;
    const cue = svg.querySelector<SVGEllipseElement>('.mg-rope-cue')!;
    const label = el('mg-rope-text', text.ready);
    area.replaceChildren(svg, label);

    let t = 0;
    let beat = 0;
    let jumpAt = -1;
    let jumpLen = 0.4;
    let cleared = 0;
    let points = 0;
    let ouchUntil = 0;
    hooks.status(`0 / ${JUMPS}`);

    const onTap = (e: PointerEvent) => {
      e.preventDefault();
      if (t < beats[0] - SLOW || t - jumpAt < jumpLen) return;
      jumpAt = t;
      jumpLen = air(beat);
      const i = beats.findIndex((b, j) => !judged[j] && t >= b - before(j) && t <= b + AFTER);
      if (i < 0) {
        if (t > beats[LEAD] - before(LEAD)) points -= WASTED;
        return;
      }
      judged[i] = true;
      if (i < LEAD) return;
      cleared++;
      points += perfect(i, beats[i] - t) ? 1 : 0.7;
      hooks.status(`${cleared} / ${JUMPS}`);
      hooks.hit();
    };
    area.addEventListener('pointerdown', onTap);

    const stopLoop = runLoop((dt) => {
      t += dt;
      while (beat < beats.length - 1 && t >= beats[beat]) beat++;
      // The rope is at the bottom on each beat; it comes over the top in front and goes back up behind.
      const from = beat === 0 ? beats[0] - SLOW : beats[beat - 1];
      const to = beats[beat] > from ? beats[beat] : from + period(beat);
      const turn = Math.max(0, (t - from) / (to - from));
      const angle = 2 * Math.PI * (turn % 1);
      const d = `M 30 70 Q 100 ${70 + 140 * Math.cos(angle)} 170 70`;
      const inFront = angle > Math.PI;
      front.setAttribute('d', inFront ? d : '');
      back.setAttribute('d', inFront ? '' : d);

      const air = jumpAt >= 0 && t - jumpAt < jumpLen ? Math.sin((Math.PI * (t - jumpAt)) / jumpLen) : 0;
      jumper.setAttribute('transform', `translate(100 ${FEET - air * 26})`);
      shadow.setAttribute('rx', String(16 - 6 * air));
      const next = beats.find((b, j) => !judged[j] && b > t - AFTER);
      cue.style.opacity = next === undefined ? '0' : String(0.5 * clamp01(1 - Math.abs(next - t) / 0.35));
      if (t > beats[LEAD] - 0.5) label.textContent = '';

      // A turn passed without a jump: the rope catches the pet's feet.
      beats.forEach((b, j) => {
        if (judged[j] || t <= b + AFTER) return;
        judged[j] = true;
        if (j < LEAD) return;
        ouchUntil = t + 0.3;
        hooks.miss();
      });
      jumper.classList.toggle('ouch', t < ouchUntil);

      const last = beats[beats.length - 1];
      hooks.progress(clamp01((t - beats[LEAD]) / (last - beats[LEAD])));
      if (t > last + AFTER + 0.4) {
        finish(Math.max(0, points) / JUMPS);
        return false;
      }
      return true;
    });
    return () => {
      stopLoop();
      area.removeEventListener('pointerdown', onTap);
    };
  });

export const GAMES: Record<TrainStat, Factory> = {
  power: smash,
  speed: catchStars,
  guard: block,
  wits: recall,
  endurance: jumpRope,
};
export const STAT_ICONS: Record<TrainStat, IconName> = {
  power: 'dumbbell',
  speed: 'wind',
  guard: 'shield',
  wits: 'bulb',
  endurance: 'bolt',
};
