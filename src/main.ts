import '@fontsource/fredoka/latin-500.css';
import '@fontsource/fredoka/latin-600.css';
import '@fontsource/nunito/latin-600.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-800.css';
import './style.css';

import { haptic, setHapticsEnabled, setMusicEnabled, setMusicMode, setSoundEnabled, sfx, suspendAudio, unlockAudio, type MusicMode } from './feedback';
import { setLang, t, type TextKey } from './i18n';
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
import { advance, gameNow, hatch, isReadyToHatch, layNewEgg, newGame } from './sim/game';
import {
  ageHours,
  cleanUp,
  feedPet,
  giveMedicine,
  hygiene,
  isSleeping,
  LIFE_STAGES,
  lifeStageIndex,
  pat,
  playWith,
  scold,
  STAGE_HOURS,
} from './sim/pet';
import { BATTLE_ENERGY, fighterFromPet, finishBattle, MOVES, wildFoe, type SideKey } from './sim/battle';
import { CHALLENGE_PARAM, encodeFighter } from './sim/battlecode';
import { speciesName, topStat } from './sim/evolution';
import { randomSeed } from './sim/rng';
import { exportSave, importSave, loadGame, saveGame } from './sim/save';
import { canTrain, finishTraining, startTraining } from './sim/training';
import type { ElementType, GameState, PetState, Stat } from './sim/types';
import { Hud, type DockAction } from './ui/hud';
import { openSettings, type InstallState } from './ui/settings';
import { Arena } from './ui/arena';
import { ActivitySheet } from './ui/sheet';
import { Training } from './ui/training';

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
setMusicEnabled(state.settings.music);
setHapticsEnabled(state.settings.haptics);
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
let endShown = false;
let petTapped = false;
let insetKey = '';

const hud = new Hud({
  onWarm: (active) => setWarming(active),
  onAction: (action) => {
    unlockAudio();
    if (state.phase === 'egg') eggAction(action);
    else petAction(action);
  },
  onMore: () => showSettings(),
});

const sheet = new ActivitySheet(() => {
  insetKey = '';
  updateHud();
});

new Training(sheet, {
  pet: () => state.pet!,
  check: () => {
    const pet = livePet();
    return pet ? canTrain(pet, gameNow(state), state.settings) : 'asleep';
  },
  start: () => {
    const pet = livePet();
    if (!pet) return false;
    if (startTraining(pet, gameNow(state)) === 'ok') return true;
    world.pet?.cower();
    sfx.scold();
    hud.toast(t('toast.refused', { name: pet.name }));
    saveGame(state);
    updateHud();
    return false;
  },
  hit: () => {
    world.pet?.hop();
    sfx.hit();
    haptic('tap');
  },
  miss: () => sfx.miss(),
  finish: (stat: Stat, score: number) => {
    const pet = state.pet!;
    const r = finishTraining(pet, stat, score);
    const at = world.pet?.center() ?? world.egg.center();
    if (score >= 0.6) {
      world.pet?.dance();
      world.effects.emit('spark', at, 14);
      sfx.play();
      haptic('success');
    } else {
      world.effects.emit('spark', at, 4);
      sfx.tap();
    }
    saveGame(state);
    updateHud();
    return r;
  },
});

/** 3D pet for a battle side: a is the player's pet, b the opponent. */
const fighter3d = (side: SideKey) => (side === 'a' ? world.pet : world.foe);
/** Particles for a hit, by the attacker's element. */
const ELEMENT_FX: Record<ElementType, 'spark' | 'drop' | 'heart'> = { ember: 'spark', tide: 'drop', bloom: 'heart', astral: 'spark' };

const arena = new Arena(sheet, {
  pet: () => state.pet!,
  check: () => {
    const pet = livePet();
    return pet ? canTrain(pet, gameNow(state), state.settings, BATTLE_ENERGY) : 'asleep';
  },
  seed: () => randomSeed(),
  wildFoe: () => wildFoe(state.pet!, randomSeed()),
  myCode: () => {
    const code = encodeFighter(fighterFromPet(state.pet!));
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set(CHALLENGE_PARAM, code);
    return { code, link: url.toString() };
  },
  share: (text, link) => void shareText(text, link),
  begin: (foe) => {
    world.startBattle(foe.type, foe.seed, foe.form, foe.stage);
    sfx.grow();
    haptic('press');
  },
  fx: (e, b) => {
    const self = fighter3d(e.side);
    switch (e.kind) {
      case 'use':
        if (MOVES[e.move].power > 0) {
          self?.lunge();
          sfx.whoosh();
        } else {
          self?.hop();
          sfx.tap();
        }
        break;
      case 'hit': {
        const target = fighter3d(e.target);
        target?.hurt();
        const at = target?.center() ?? world.egg.center();
        world.effects.emit(ELEMENT_FX[b[e.side].f.type], at, e.crit ? 14 : 8);
        sfx.strike(e.crit || e.factor > 1);
        if (e.target === 'a') haptic(e.crit ? 'crit' : 'hit');
        break;
      }
      case 'miss':
        sfx.miss();
        break;
      case 'heal':
      case 'focus':
      case 'guard':
        world.effects.emit(e.kind === 'heal' ? 'heart' : 'spark', self?.center() ?? world.egg.center(), 6);
        sfx.cure();
        break;
      case 'dazed':
      case 'ignore':
      case 'skip':
        world.effects.emit('zzz', self?.center() ?? world.egg.center(), 1);
        sfx.nope();
        break;
      case 'faint':
        self?.faint();
        fighter3d(e.side === 'a' ? 'b' : 'a')?.dance();
        sfx.faint();
        break;
    }
  },
  finish: (outcome) => {
    const pet = state.pet!;
    const r = finishBattle(pet, outcome, randomSeed());
    if (outcome === 'won') {
      sfx.win();
      haptic('celebrate');
    } else if (outcome === 'lost') sfx.lose();
    saveGame(state);
    updateHud();
    return r;
  },
  end: () => world.endBattle(),
});

async function shareText(text: string, link: string) {
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Pet Hatch', text, url: link });
      return;
    }
  } catch (e) {
    // The share sheet was dismissed: nothing to do.
    if ((e as Error).name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(`${text} ${link}`);
    hud.toast(t('toast.linkCopied'));
  } catch {
    hud.toast(t('toast.copyFailed'));
  }
}

const eggActive = () => state.phase === 'egg' && !state.egg.failed;
const livePet = (): PetState | null => (state.phase === 'hatched' && state.pet?.status === 'alive' ? state.pet : null);

function toggleLights() {
  state.egg.lightsOn = !state.egg.lightsOn;
  sfx.toggle();
  hud.toast(t(state.egg.lightsOn ? 'toast.lightsOn' : 'toast.lightsOff'));
  updateHud();
}

// ---------- egg care ----------

function eggAction(action: DockAction) {
  if (action === 'mist') mist();
  else if (action === 'sing') sing();
  else if (action === 'turn') turn(Math.random() < 0.5 ? 1 : -1);
  else if (action === 'lights') toggleLights();
}

function setWarming(active: boolean) {
  unlockAudio();
  if (!eggActive()) return;
  if (active && !warming) {
    sfx.warm();
    haptic('tap');
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
  haptic('tap');
  hud.toast(t(added <= 0 ? 'toast.full' : 'toast.misted'));
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
    haptic('press');
    hud.toast(t('toast.turned'));
  } else {
    world.egg.nudge(1, direction > 0 ? 0 : Math.PI);
    sfx.nope();
    hud.toast(t('toast.turnedRecently'));
  }
}

function stroke(px: number) {
  if (!eggActive()) return;
  comfortEgg(state.egg, px * STROKE_PER_PIXEL);
  strokeAcc += px;
  if (strokeAcc > 120) {
    strokeAcc = 0;
    world.effects.emit('heart', world.egg.center(), 1);
    world.egg.nudge(0.5);
    haptic('tick');
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
    haptic('press');
    if (rushLeft <= 0) doHatch();
    updateHud();
    return;
  }
  comfortEgg(state.egg, 2);
  world.egg.nudge(1.2);
  world.effects.emit('heart', world.egg.center(), 1);
  sfx.tap();
}

// ---------- pet care ----------

function petAction(action: DockAction) {
  const pet = livePet();
  if (!pet) return;
  const now = gameNow(state);
  const view = world.pet;
  const name = { name: pet.name };
  const at = () => view?.center() ?? world.egg.center();

  switch (action) {
    case 'lights':
      toggleLights();
      return;
    case 'train':
      sfx.tap();
      sheet.open('train');
      return;
    case 'feed': {
      const r = feedPet(pet, now, state.settings);
      if (r === 'ok') {
        view?.eat();
        sfx.eat();
        haptic('tap');
        setTimeout(() => world.effects.emit('heart', at(), 2), 1300);
        hud.toast(t('toast.fed'));
      } else {
        sfx.nope();
        hud.toast(t(r === 'full' ? 'toast.notHungry' : 'toast.asleep', name));
      }
      break;
    }
    case 'clean': {
      const spots = world.droppingPositions();
      if (cleanUp(pet) > 0) {
        for (const p of spots) {
          world.effects.emit('spark', p, 6);
          world.effects.emit('drop', p.clone().setY(p.y - 1), 4);
        }
        world.setDroppings(pet.droppings);
        sfx.mist();
        haptic('tap');
        hud.toast(t('toast.cleaned'));
      } else hud.toast(t('toast.alreadyClean'));
      break;
    }
    case 'play': {
      const r = playWith(pet, now, state.settings);
      if (r === 'ok') {
        view?.dance();
        sfx.play();
        haptic('success');
        for (let i = 0; i < 4; i++) setTimeout(() => world.effects.emit(i % 2 ? 'note' : 'heart', at(), 1), i * 300);
        hud.toast(t('toast.played'));
      } else {
        sfx.nope();
        hud.toast(t(r === 'tired' ? 'toast.tired' : 'toast.asleep', name));
      }
      break;
    }
    case 'medicine': {
      const r = giveMedicine(pet);
      if (r === 'cured') {
        world.effects.emit('spark', at(), 14);
        sfx.cure();
        haptic('success');
      } else if (r === 'dose') {
        world.effects.emit('spark', at(), 5);
        sfx.cure();
      } else {
        view?.cower();
        sfx.nope();
      }
      hud.toast(t(r === 'cured' ? 'toast.cured' : r === 'dose' ? 'toast.dose' : 'toast.notSick'));
      break;
    }
    case 'scold': {
      const r = scold(pet);
      view?.cower();
      sfx.scold();
      haptic('warn');
      hud.toast(t(r === 'disciplined' ? 'toast.disciplined' : r === 'unfair' ? 'toast.unfair' : 'toast.confused', name));
      break;
    }
  }
  saveGame(state);
  updateHud();
}

function tapPet() {
  const pet = livePet();
  if (!pet || !world.pet) return;
  petTapped = true;
  if (isSleeping(pet, gameNow(state), state.settings)) {
    world.effects.emit('zzz', world.pet.center(), 1);
    return;
  }
  pat(pet);
  world.pet.hop();
  world.effects.emit('heart', world.pet.center(), 2);
  sfx.tap();
  haptic('tap');
}

// ---------- hatching and life events ----------

function doHatch() {
  rushLeft = null;
  const pet = hatch(state, gameNow(state), false);
  burstAndReveal(pet, false);
}

function burstAndReveal(pet: PetState, alone: boolean) {
  world.effects.shatter(world.egg.center());
  world.effects.emit('spark', world.egg.center(), 18);
  world.showPet(pet.type, pet.seed, pet.shownStage, pet.shownForm, true);
  sfx.hatch();
  haptic('hatch');
  saveGame(state);
  updateHud();
  setTimeout(() => {
    const type = t(`type.${pet.type}`);
    const h = state.egg.heritage;
    const body =
      (alone ? `${t('reveal.alone')} ` : '') +
      t(`reveal.body.${pet.type}`) +
      (h ? ` ${t('reveal.heritage', { parent: h.parentName, stat: t(`stat.${h.stat}`), n: h.bonus })}` : '');
    hud.showOverlay(
      t('reveal.title', { type }),
      body,
      t('reveal.button'),
      (name) => {
        if (name) pet.name = name;
        pet.revealSeen = true;
        saveGame(state);
        updateHud();
      },
      { label: t('reveal.nameLabel'), value: pet.name },
    );
  }, 1100);
}

/** Play a stage change the player hasn't seen yet: grow, and if the form changed, explain the evolution. */
function evolve(pet: PetState) {
  const evolved = pet.form !== pet.shownForm;
  const stage = Math.min(pet.stage, LIFE_STAGES.length - 1);
  pet.shownStage = pet.stage;
  pet.shownForm = pet.form;
  saveGame(state);
  world.pet?.setForm(pet.form, stage, true);
  world.effects.emit('spark', world.pet?.center() ?? world.egg.center(), 24);
  sfx.grow();
  haptic('celebrate');
  const name = pet.name;
  if (!evolved) {
    hud.toast(t('toast.grew', { name, stage: t(`life.${LIFE_STAGES[stage]}`) }));
    return;
  }
  const species = speciesName(pet.type, pet.form);
  const why = pet.form.startsWith('adult.')
    ? t('evolve.why.adult', { stat: t(`stat.${pet.form.slice('adult.'.length) as Stat}`) })
    : t(`evolve.why.${pet.form}` as TextKey);
  setTimeout(
    () => hud.showOverlay(t('evolve.title', { name }), `${t('evolve.body', { name, species })} ${why}`, t('evolve.button'), updateHud),
    1900,
  );
}

function showEnding(pet: PetState) {
  endShown = true;
  warming = false;
  sheet.close();
  const name = { name: pet.name };
  if (pet.status === 'retired') {
    world.pet?.dance();
    world.effects.emit('spark', world.pet?.center() ?? world.egg.center(), 30);
    sfx.grow();
  }
  const key = pet.status === 'ranAway' ? 'ranAway' : pet.status === 'died' ? 'died' : 'retired';
  if (key !== 'retired' && world.pet) {
    world.effects.emit('spark', world.pet.center(), 12);
    world.scene.remove(world.pet.group);
  }
  hud.setMode('none');
  hud.setHint('');
  setTimeout(
    () =>
      hud.showOverlay(
        t(`end.${key}.title` as TextKey, name),
        t(`end.${key}.body` as TextKey) +
          (key === 'retired' ? ` ${t('end.retired.heritage', { name: pet.name, stat: t(`stat.${topStat(pet)}`) })}` : ''),
        t(key === 'retired' ? 'end.retired.button' : 'failed.button'),
        startNewEgg,
      ),
    pet.status === 'retired' ? 1600 : 400,
  );
}

function startNewEgg() {
  layNewEgg(state, gameNow(state));
  saveGame(state);
  location.reload();
}

// ---------- HUD ----------

function eggHint(now: number): [string, boolean] {
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

function petHint(pet: PetState, now: number): [string, boolean] {
  const name = { name: pet.name };
  if (isAsleep(now, state.settings)) return [t(state.egg.lightsOn ? 'hint.lightsNight' : 'hint.sleep'), false];
  if (pet.napping) return [t('hint.pet.napping', name), false];
  if (pet.sick) return [t('hint.pet.sick', name), true];
  if (pet.call?.kind === 'fake') return [t('hint.pet.callFake', name), true];
  if (pet.hunger < 30) return [t('hint.pet.hungry', name), pet.hunger < 20];
  if (pet.droppings.length) return [t('hint.pet.dirty'), pet.droppings.length > 1];
  if (pet.mood < 30) return [t('hint.pet.bored', name), pet.mood < 20];
  if (pet.call) return [t('hint.pet.callNeed', name), true];
  if (pet.energy < 20) return [t('hint.pet.tired', name), false];
  if (pet.energy >= 80 && canTrain(pet, now, state.settings) === 'ok') return [t('hint.pet.train', name), false];
  return [t(petTapped ? 'hint.pet.fine' : 'hint.pet.tap', name), false];
}

/** Battle music in a fight, a lullaby in the evening, silence once the lights are off for the night. */
function musicFor(now: number): MusicMode {
  if (world.foe) return 'battle';
  const asleep = isAsleep(now, state.settings);
  if (asleep && !state.egg.lightsOn) return 'off';
  const hour = localHour(now);
  return asleep || hour >= 19 || hour < 7 ? 'night' : 'day';
}

function formatAge(hours: number): string {
  const d = Math.floor(hours / 24);
  const h = Math.floor(hours % 24);
  return d > 0 ? t('dur.dh', { d, h }) : t('dur.h', { h });
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
    hud.setMode(egg.failed ? 'none' : 'egg');
    const h = egg.heritage;
    hud.setHeader(
      h ? t('egg.titleFrom', { name: h.parentName }) : t('egg.title'),
      `${t('egg.day', { n: day })} · ${asleep ? t('egg.sleeping') : t(`egg.mood.${stage}` as TextKey)}`,
      h ? [{ text: t('gen', { n: h.generation }), tone: 'neutral' }] : [],
    );
    hud.setStage(stage);
    hud.setNeeds({
      warmth: egg.warmth / 100,
      humidity: egg.humidity / 100,
      bond: egg.bond / 100,
      turn: hoursUntilTurn(egg, now) / TURN_INTERVAL_H,
    });
    hud.setLeaning(careLeaning(egg));
    const [text, urgent] = eggHint(now);
    hud.setHint(egg.failed ? '' : text, urgent);
    hud.setDockState({ turn: hoursUntilTurn(egg, now) < 0.5 }, egg.lightsOn);
    world.egg.draw({ crack: crackLevel(), leaning: careLeaning(egg), failed: egg.failed });
  } else if (state.pet && !endShown) {
    const pet = state.pet;
    const stage = Math.min(pet.shownStage, LIFE_STAGES.length - 1);
    const sleeping = isSleeping(pet, now, state.settings);
    const feel = pet.sick
      ? 'sick'
      : isAsleep(now, state.settings)
        ? 'sleeping'
        : pet.napping
          ? 'napping'
          : pet.mood >= 60
            ? 'happy'
            : pet.mood >= 30
              ? 'ok'
              : 'sad';
    hud.setMode('pet');
    const species = speciesName(pet.type, pet.shownForm);
    const age = t('pet.age', { age: formatAge(ageHours(pet, now)) });
    hud.setHeader(pet.name, `${species} · ${age} · ${t(`pet.feel.${feel}` as TextKey)}`, [
      { text: t(`type.${pet.type}`), tone: pet.type },
      { text: t(`life.${LIFE_STAGES[stage]}`), tone: 'neutral' },
      ...(pet.generation > 1 ? [{ text: t('gen', { n: pet.generation }), tone: 'neutral' as const }] : []),
    ]);
    hud.setNeeds({
      hunger: pet.hunger / 100,
      mood: pet.mood / 100,
      energy: pet.energy / 100,
      hygiene: hygiene(pet) / 100,
    });
    const health = pet.sick ? 'sick' : pet.health < 40 ? 'weak' : 'good';
    hud.setVitals(t(`pet.health.${health}` as TextKey), health !== 'good', pet.discipline / 100);
    const [text, urgent] = petHint(pet, now);
    hud.setHint(text, urgent);
    hud.setDockState(
      {
        feed: pet.hunger < 30 && !sleeping,
        clean: pet.droppings.length > 0,
        play: pet.mood < 30 && !sleeping,
        medicine: pet.sick,
      },
      state.egg.lightsOn,
    );
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
    family: state.family,
    onChange: (patch) => {
      Object.assign(state.settings, patch);
      if (patch.language) {
        setLang(patch.language);
        hud.applyLanguage();
      }
      if (patch.sound !== undefined) setSoundEnabled(patch.sound);
      if (patch.music !== undefined) setMusicEnabled(patch.music);
      if (patch.haptics !== undefined) setHapticsEnabled(patch.haptics);
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
      let loaded: GameState;
      try {
        loaded = importSave(code);
      } catch {
        return false;
      }
      // Replace the game in memory too: reloading triggers the save-on-leave handler, which would
      // otherwise write the old game straight back over the imported one.
      Object.assign(state, loaded);
      saveGame(state);
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
            if (state.phase === 'egg') state.egg.devHours = state.egg.baseHours;
            else if (state.pet) {
              // Jump to the start of the next life stage.
              const now = gameNow(state);
              const next = lifeStageIndex(state.pet, now) + 1;
              let h = 0;
              for (const stage of LIFE_STAGES.slice(0, next)) h += STAGE_HOURS[stage];
              state.clockOffset += Math.max(0, h - ageHours(state.pet, now)) * HOUR + 60_000;
            }
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
    else tapPet();
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
  suspendAudio(document.hidden);
  if (document.hidden) {
    warming = false;
    saveGame(state);
  }
});
window.addEventListener('pagehide', () => saveGame(state));

// ---------- start ----------

if (state.phase === 'hatched' && state.pet) {
  const pet = state.pet;
  if (!pet.revealSeen) setTimeout(() => burstAndReveal(pet, pet.hatchedAlone), 700);
  else {
    world.showPet(pet.type, pet.seed, Math.min(pet.shownStage, LIFE_STAGES.length - 1), pet.shownForm, false);
    world.setDroppings(pet.droppings);
  }
}

// A friend's challenge link: open the Battle tab with their code filled in.
const challenge = params.get(CHALLENGE_PARAM);
if (challenge) {
  const url = new URL(location.href);
  url.searchParams.delete(CHALLENGE_PARAM);
  history.replaceState(null, '', url);
  if (livePet()?.revealSeen) setTimeout(() => arena.challenge(challenge), 600);
  else setTimeout(() => hud.toast(t('battle.needPet')), 800);
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
  if (wasEgg && state.phase === 'hatched' && state.pet) burstAndReveal(state.pet, true);

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
  } else if (state.phase === 'egg' && egg.failed && !endShown) {
    endShown = true;
    updateHud();
    hud.showOverlay(t('failed.title'), t('failed.body'), t('failed.button'), startNewEgg);
  }

  const pet = state.pet;
  if (state.phase === 'hatched' && pet && world.pet) {
    if (pet.status !== 'alive') {
      if (!endShown && pet.revealSeen) showEnding(pet);
    } else {
      if (pet.stage > pet.shownStage && pet.revealSeen && !hud.overlayOpen && !sheet.isOpen) evolve(pet);
      const sleeping = isSleeping(pet, now, state.settings);
      world.pet.setLook({ sleeping, sick: pet.sick, calling: pet.call !== null && !sheet.isOpen, mood: pet.mood });
      world.setDroppings(pet.droppings);
      if (sleeping && Math.random() < dt / 2) world.effects.emit('zzz', world.pet.center(), 1);
    }
  }

  world.egg.update(dt, { warmth: egg.warmth, ready: rushLeft !== null });
  world.render(dt, time, localHour(now), !egg.lightsOn);

  hudTimer -= dt;
  if (hudTimer <= 0) {
    hudTimer = 0.2;
    updateHud();
    setMusicMode(musicFor(now));
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
