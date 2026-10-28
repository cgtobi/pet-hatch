import '@fontsource/fredoka/latin-500.css';
import '@fontsource/fredoka/latin-600.css';
import '@fontsource/nunito/latin-600.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-800.css';
import './style.css';

import { buzz, setSoundEnabled, sfx, unlockAudio } from './feedback';
import { setLang, t } from './i18n';
import { attachGestures } from './input/gestures';
import { World } from './scene/world';
import { HOUR, isAsleep, localHour } from './sim/clock';
import {
  careLeaning,
  comfortEgg,
  hatchStage,
  hoursUntilTurn,
  isTurnOverdue,
  mistEgg,
  turnEgg,
  TURN_INTERVAL_H,
  warmEgg,
} from './sim/egg';
import { advance, gameNow, hatch, isReadyToHatch, newGame } from './sim/game';
import { exportSave, importSave, loadGame, saveGame } from './sim/save';
import type { GameState } from './sim/types';
import { Hud } from './ui/hud';
import { openSettings, type InstallState } from './ui/settings';

const params = new URLSearchParams(location.search);
/** Debug: run game time faster than real time, e.g. ?speed=600. */
const SPEED = Math.max(1, Number(params.get('speed')) || 1);
const DEBUG = params.has('debug') || SPEED > 1;

const WARM_PER_SECOND = 22;
const STROKE_PER_PIXEL = 0.06;
const SING_AMOUNT = 25;
const SING_COOLDOWN = 2.5;
const RUSH_TAPS = 12;
/** Idle wobble per visible stage: seconds between wobbles and their strength. */
const WOBBLE = [
  { every: 0, strength: 0 },
  { every: 9, strength: 1.2 },
  { every: 3.5, strength: 2 },
  { every: 1.8, strength: 2.6 },
  { every: 0.8, strength: 3.4 },
];

const state: GameState = loadGame() ?? newGame(Date.now());
setLang(state.settings.language);
setSoundEnabled(state.settings.sound);
advance(state, gameNow(state));

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const world = new World(canvas, state.egg.seed);

let warming = false;
let warmFx = 0;
let strokeAcc = 0;
let singCooldown = 0;
let wobbleTimer = 2;
let rushLeft: number | null = null;
let lastStage = hatchStage(state.egg);
let failedShown = false;
let insetKey = '';

const hud = new Hud({
  onWarm: (active) => setWarming(active),
  onAction: (action) => {
    unlockAudio();
    if (action === 'mist') mist();
    else if (action === 'sing') sing();
    else if (action === 'turn') turn(Math.random() < 0.5 ? 1 : -1);
    else toggleLights();
  },
  onMore: () => showSettings(),
});

const eggActive = () => state.phase === 'egg' && !state.egg.failed;

// ---------- care actions ----------

function setWarming(active: boolean) {
  unlockAudio();
  if (!eggActive()) return;
  if (active && !warming) {
    sfx.warm();
    buzz(10);
  }
  if (!active && warming && state.egg.warmth >= 99) hud.toast(t('toast.toasty'));
  warming = active;
}

function mist() {
  if (!eggActive()) return;
  const added = mistEgg(state.egg);
  world.effects.emit('drop', world.egg.center(), 12);
  world.egg.nudge(0.8);
  sfx.mist();
  buzz(8);
  if (added <= 0) hud.toast(t('toast.full'));
  else hud.toast(t('toast.misted'));
}

function sing() {
  if (!eggActive() || singCooldown > 0) return;
  singCooldown = SING_COOLDOWN;
  const added = comfortEgg(state.egg, SING_AMOUNT);
  sfx.sing();
  for (let i = 0; i < 5; i++) {
    setTimeout(() => {
      world.effects.emit('note', world.egg.center(), 1);
      world.egg.nudge(0.7, i % 2 ? 0 : Math.PI);
    }, i * 140);
  }
  if (added <= 0) hud.toast(t('toast.full'));
}

function turn(direction: 1 | -1) {
  if (!eggActive()) return;
  if (turnEgg(state.egg, gameNow(state))) {
    world.egg.roll(direction);
    sfx.turn();
    buzz(15);
    hud.toast(t('toast.turned'));
  } else {
    world.egg.nudge(1, direction > 0 ? 0 : Math.PI);
    sfx.nope();
    hud.toast(t('toast.turnedRecently'));
  }
}

function toggleLights() {
  if (state.phase !== 'egg') return;
  state.egg.lightsOn = !state.egg.lightsOn;
  sfx.toggle();
  hud.toast(t(state.egg.lightsOn ? 'toast.lightsOn' : 'toast.lightsOff'));
  updateHud();
}

function stroke(px: number) {
  if (!eggActive()) return;
  comfortEgg(state.egg, px * STROKE_PER_PIXEL);
  strokeAcc += px;
  if (strokeAcc > 120) {
    strokeAcc = 0;
    world.effects.emit('heart', world.egg.center(), 1);
    world.egg.nudge(0.5);
    buzz(5);
  }
}

function tapEgg() {
  if (!eggActive()) return;
  if (rushLeft !== null) {
    rushLeft--;
    world.egg.nudge(4);
    world.egg.jump(1.6);
    world.egg.flashCracks();
    world.effects.emit('spark', world.egg.center(), 4);
    sfx.crack();
    buzz(20);
    if (rushLeft <= 0) doHatch();
    updateHud();
    return;
  }
  comfortEgg(state.egg, 2);
  world.egg.nudge(1.2);
  world.effects.emit('heart', world.egg.center(), 1);
  sfx.tap();
}

// ---------- hatching ----------

function doHatch() {
  rushLeft = null;
  const pet = hatch(state, gameNow(state), false);
  burstAndReveal(pet.type, false);
}

function burstAndReveal(type: NonNullable<GameState['pet']>['type'], alone: boolean) {
  world.effects.shatter(world.egg.center());
  world.effects.emit('spark', world.egg.center(), 18);
  world.showBaby(type, true);
  sfx.hatch();
  buzz([30, 40, 80]);
  saveGame(state);
  updateHud();
  setTimeout(() => {
    const name = t(`type.${type}`);
    const body = (alone ? `${t('reveal.alone')} ` : '') + t(`reveal.body.${type}`);
    hud.showOverlay(t('reveal.title', { type: name }), body, t('reveal.button'), () => {
      if (state.pet) state.pet.revealSeen = true;
      saveGame(state);
    });
  }, 1100);
}

function startNewEgg() {
  const fresh = newGame(Date.now(), state.settings);
  saveGame(fresh);
  location.reload();
}

// ---------- HUD ----------

function hint(now: number): [string, boolean] {
  const egg = state.egg;
  if (rushLeft !== null) return [rushLeft < RUSH_TAPS ? t('hint.rush', { n: rushLeft }) : t('hint.ready'), false];
  if (isAsleep(now, state.settings)) return [t(egg.lightsOn ? 'hint.lightsNight' : 'hint.sleep'), false];
  if (egg.warmth < 20) return [t('hint.cold'), true];
  if (isTurnOverdue(egg, now)) return [t('hint.turnNow'), true];
  if (egg.humidity < 20) return [t('hint.dry'), true];
  if (egg.bond < 20) return [t('hint.lonely'), true];
  if (careLeaning(egg).total < 40) return [t('hint.firstTime'), false];
  const h = hoursUntilTurn(egg, now);
  return [h < 1 ? t('hint.turnSoonest') : t('hint.turnSoon', { h: Math.round(h) }), false];
}

function crackLevel(): number {
  const egg = state.egg;
  const stage = hatchStage(egg);
  if (stage < 3) return 0;
  if (egg.readyAt !== null) return 0.85 + 0.15 * (rushLeft === null ? 0 : 1 - rushLeft / RUSH_TAPS);
  const from = egg.thresholds[2];
  const f = egg.devHours / egg.baseHours;
  return 0.15 + 0.6 * Math.min(1, Math.max(0, (f - from) / (1 - from)));
}

function updateHud() {
  const now = gameNow(state);
  const egg = state.egg;
  if (state.phase === 'egg') {
    const stage = hatchStage(egg);
    const day = Math.floor((now - egg.laidAt) / (24 * HOUR)) + 1;
    const asleep = isAsleep(now, state.settings) && !egg.lightsOn;
    hud.setHeader(t('egg.title'), `${t('egg.day', { n: day })} · ${asleep ? t('egg.sleeping') : t(`egg.mood.${stage}` as 'egg.mood.0')}`);
    hud.setStage(stage);
    hud.setNeeds({
      warmth: egg.warmth / 100,
      humidity: egg.humidity / 100,
      bond: egg.bond / 100,
      turn: hoursUntilTurn(egg, now) / TURN_INTERVAL_H,
    });
    hud.setLeaning(careLeaning(egg));
    const [text, urgent] = hint(now);
    hud.setHint(egg.failed ? '' : text, urgent);
    hud.setDock(!egg.failed, { turnDue: hoursUntilTurn(egg, now) < 0.5, lightsOn: egg.lightsOn });
    world.egg.draw({ crack: crackLevel(), leaning: careLeaning(egg), failed: egg.failed });
  } else if (state.pet) {
    const name = t(`type.${state.pet.type}`);
    const days = Math.floor((now - state.pet.hatchedAt) / (24 * HOUR));
    hud.setHeader(
      t('pet.title', { type: name }),
      t('pet.subtitle', { when: days < 1 ? t('pet.today') : t('pet.daysAgo', { n: days }) }),
    );
    hud.setStage(null);
    hud.setNeeds(null);
    hud.setLeaning(null);
    hud.setHint(t('pet.hint'));
    hud.setDock(false);
  }

  const insets = hud.insets();
  const key = `${Math.round(insets.top)}|${Math.round(insets.bottom)}`;
  if (key !== insetKey) {
    insetKey = key;
    world.setInsets(insets);
  }
}

// ---------- settings & install ----------

let installPrompt: (Event & { prompt(): Promise<void> }) | null = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e as typeof installPrompt;
});

function installState(): InstallState {
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    canPrompt: installPrompt !== null,
    standalone: matchMedia('(display-mode: standalone)').matches || nav.standalone === true,
    ios: /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
  };
}

function showSettings() {
  openSettings(document.getElementById('settings') as HTMLDialogElement, state.settings, installState(), {
    onChange: (patch) => {
      Object.assign(state.settings, patch);
      if (patch.language) {
        setLang(patch.language);
        hud.applyLanguage();
      }
      if (patch.sound !== undefined) setSoundEnabled(patch.sound);
      saveGame(state);
      updateHud();
    },
    onExport: async () => {
      const code = exportSave(state);
      try {
        await navigator.clipboard.writeText(code);
        hud.toast(t('toast.copied'));
      } catch {
        hud.toast(t('toast.copyFailed'));
      }
      return code;
    },
    onImport: (code) => {
      try {
        saveGame(importSave(code));
      } catch {
        return false;
      }
      location.reload();
      return true;
    },
    onNewEgg: startNewEgg,
    onInstall: async () => {
      await installPrompt?.prompt();
      installPrompt = null;
    },
    debug: DEBUG
      ? {
          skip: (hours) => {
            state.clockOffset += hours * HOUR;
            updateHud();
          },
          readyNow: () => {
            state.egg.devHours = state.egg.baseHours;
            updateHud();
          },
        }
      : null,
  });
}

// ---------- input ----------

attachGestures(canvas, {
  pick: (x, y) => world.pick(x, y),
  onWarm: setWarming,
  onStroke: stroke,
  onMist: mist,
  onTurn: turn,
  onTap: (target) => {
    unlockAudio();
    if (target === 'egg') tapEgg();
    else {
      world.effects.emit('heart', world.egg.center().setY(1), 2);
      sfx.tap();
    }
  },
  onOrbit: (dx) => world.orbit(dx),
  onOrbitEnd: (vx) => world.release(vx),
});

window.addEventListener('resize', () => {
  world.resize();
  insetKey = '';
  updateHud();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    warming = false;
    saveGame(state);
  }
});
window.addEventListener('pagehide', () => saveGame(state));

// ---------- start ----------

if (state.phase === 'hatched' && state.pet) {
  if (state.pet.revealSeen) world.showBaby(state.pet.type, false);
  else {
    const { type, hatchedAlone } = state.pet;
    setTimeout(() => burstAndReveal(type, hatchedAlone), 700);
  }
}

let last = performance.now();
let time = 0;
let hudTimer = 0;
let saveTimer = 5;

function frame(ms: number) {
  const dt = Math.min(0.1, (ms - last) / 1000);
  last = ms;
  time += dt;
  if (SPEED > 1) state.clockOffset += dt * 1000 * (SPEED - 1);
  const now = gameNow(state);
  const wasEgg = state.phase === 'egg';
  advance(state, now);
  if (wasEgg && state.phase === 'hatched' && state.pet) burstAndReveal(state.pet.type, true);

  const egg = state.egg;
  singCooldown = Math.max(0, singCooldown - dt);
  if (eggActive()) {
    if (warming) {
      warmEgg(egg, WARM_PER_SECOND * dt);
      warmFx -= dt;
      if (warmFx <= 0) {
        warmFx = 0.3;
        world.effects.emit('spark', world.egg.center(), 1);
      }
    }
    if (isReadyToHatch(state) && rushLeft === null && !document.hidden) rushLeft = RUSH_TAPS;

    const stage = hatchStage(egg);
    if (stage > lastStage) {
      sfx.crack();
      world.egg.jump(2);
      world.egg.flashCracks();
    }
    lastStage = stage;

    const sleepy = isAsleep(now, state.settings) && !egg.lightsOn;
    const w = WOBBLE[stage];
    wobbleTimer -= dt;
    if (w.every > 0 && wobbleTimer <= 0) {
      wobbleTimer = w.every * (0.6 + Math.random() * 0.8) * (sleepy ? 3 : 1);
      world.egg.nudge(w.strength * (sleepy ? 0.4 : 1));
      if (stage >= 4) world.egg.jump(0.8);
    }
    if (sleepy && Math.random() < dt / 2.5) world.effects.emit('zzz', world.egg.center(), 1);
  } else if (egg.failed && !failedShown && state.phase === 'egg') {
    failedShown = true;
    updateHud();
    hud.showOverlay(t('failed.title'), t('failed.body'), t('failed.button'), startNewEgg);
  }

  world.egg.update(dt, { warmth: egg.warmth, ready: rushLeft !== null });
  world.render(dt, time, localHour(now), state.phase === 'egg' && !egg.lightsOn);

  hudTimer -= dt;
  if (hudTimer <= 0) {
    hudTimer = 0.2;
    updateHud();
  }
  saveTimer -= dt;
  if (saveTimer <= 0) {
    saveTimer = 5;
    saveGame(state);
  }
  requestAnimationFrame(frame);
}

updateHud();
requestAnimationFrame(frame);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // Offline support is a bonus; the game works without it.
  });
}
