import '@fontsource/fredoka/latin-500.css';
import '@fontsource/fredoka/latin-600.css';
import '@fontsource/nunito/latin-600.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-800.css';
import './style.css';

import { haptic, setHapticsEnabled, setMusicEnabled, setMusicMode, setSoundEnabled, sfx, suspendAudio, unlockAudio } from './feedback';
import { listOf, setLang, t, type TextKey } from './i18n';
import { attachGestures } from './input/gestures';
import { World } from './scene/world';
import { dayPart, HOUR, isAsleep, localHour } from './sim/clock';
import { sunAt } from './sim/sun';
import {
  careLeaning,
  comfortEgg,
  hatchStage,
  hoursUntilTurn,
  mistEgg,
  turnEgg,
  TURN_INTERVAL_H,
  warmEgg,
  type CareResult,
} from './sim/egg';
import { advance, gameNow, hatch, heritageOf, isReadyToHatch, layNewEgg, NEGLECT_MODES, newGame } from './sim/game';
import {
  ageHours,
  cleanUp,
  feedPet,
  giveMedicine,
  hygiene,
  isSleeping,
  LIFE_STAGES,
  lifeStageIndex,
  endPowerNap,
  lightSwitched,
  pat,
  playWith,
  scold,
  napCheck,
  startPowerNap,
  wakeAtNight,
  SHELL_DAYS,
  stageHours,
} from './sim/pet';
import { BATTLE_ENERGY, fighterFromPet, finishBattle, MOVES, wildFoe, type SideKey } from './sim/battle';
import { findRelay } from './net/relayConfig';
import { CHALLENGE_PARAM, cleanName, encodeFighter } from './sim/battlecode';
import { speciesName } from './sim/evolution';
import { randomSeed } from './sim/rng';
import { exportSave, importSave, loadGame, saveGame } from './sim/save';
import { canTrain, finishTraining, masteredStats, maxEnergy, startTraining, type TrainStat } from './sim/training';
import type { ElementType, FormId, GameState, NeglectMode, PetState, Stat } from './sim/types';
import { Hud, type DockAction, type LightButton } from './ui/hud';
import { openSettings, type InstallState } from './ui/settings';
import { Arena } from './ui/arena';
import { ActivitySheet } from './ui/sheet';
import { Training } from './ui/training';
import { crackLevel, eggHint, musicFor, petFeel, petHealth, petHint } from './ui/status';
import { icon } from './ui/icons';
import { watchForUpdates } from './update';
import { findStats, report, type PetEnding } from './net/stats';

const params = new URLSearchParams(location.search);
/** Invite links for live battles: ?live=ROOM. */
const LIVE_PARAM = 'live';
/** Debug: run game time faster than real time, e.g. ?speed=600. */
const SPEED = Math.max(1, Number(params.get('speed')) || 1);
const DEBUG = params.has('debug') || SPEED > 1;
/** Debug: show the sky at this hour instead of the game's (the game itself keeps its own time). */
let skyHour: number | null = null;

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

const saved = loadGame();
const state: GameState = saved ?? newGame(Date.now());
setLang(state.settings.language);
setSoundEnabled(state.settings.sound);
setMusicEnabled(state.settings.music);
setHapticsEnabled(state.settings.haptics);
advance(state, gameNow(state));

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const world = new World(canvas, state.egg.seed);

let warming = false;
let warmFx = 0;
/** Pampering given during the current hold of Warm, for the toast when it ends. */
let warmPampered = 0;
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
  onLightButton: () => {
    unlockAudio();
    lightButton();
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
  finish: (stat: TrainStat, score: number) => {
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

/** 3D creature for a battle side: the player's own side is their pet, the other is the opponent. */
const fighter3d = (side: SideKey, me: SideKey) => (side === me ? world.pet : world.foe);
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
  liveLink: (room) => {
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set(LIVE_PARAM, room);
    return url.toString();
  },
  share: (text, link) => void shareText(text, link),
  begin: (foe) => {
    world.startBattle(foe.type, foe.seed, foe.form, foe.stage);
    sfx.grow();
    haptic('press');
  },
  fx: (e, b, me) => {
    const self = fighter3d(e.side, me);
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
        const target = fighter3d(e.target, me);
        target?.hurt();
        const at = target?.center() ?? world.egg.center();
        world.effects.emit(ELEMENT_FX[b[e.side].f.type], at, e.crit ? 14 : 8);
        sfx.strike(e.crit || e.factor > 1);
        if (e.target === me) haptic(e.crit ? 'crit' : 'hit');
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
        fighter3d(e.side === 'a' ? 'b' : 'a', me)?.dance();
        sfx.faint();
        break;
    }
  },
  finish: (outcome, _foe, summary) => {
    const pet = state.pet!;
    const r = finishBattle(pet, outcome, randomSeed(), summary);
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

/** What the round button beside More does right now. */
function lightButtonKind(pet: PetState, now: number): LightButton {
  if (dayPart(now, state.settings) !== 'day') return 'light';
  return pet.powerNap ? 'wake' : 'nap';
}

/** Nap or Wake up by day; in the evening and at night, the light. */
function lightButton() {
  const pet = livePet();
  if (!pet) return;
  const now = gameNow(state);
  const at = () => world.pet?.center() ?? world.egg.center();
  let key: TextKey;
  const kind = lightButtonKind(pet, now);
  if (kind === 'wake') {
    const r = endPowerNap(pet, now);
    key = r === 'grumpy' ? 'toast.wokeGrumpy' : 'toast.wokeEarly';
    if (r === 'grumpy') world.pet?.cower();
    sfx.toggle();
  } else if (kind === 'nap') {
    const r = startPowerNap(pet, now, state.settings);
    key = r === 'ok' ? 'toast.napStart' : r === 'needsCare' ? 'toast.napNeeds' : r === 'napping' ? 'toast.asleep' : 'toast.notSleepy';
    if (r === 'ok') world.effects.emit('zzz', at(), 2);
    else if (r === 'notSleepy') world.pet?.hop();
    sfx.tap();
  } else {
    const lit = (state.egg.lightsOn = !state.egg.lightsOn);
    sfx.toggle();
    const r = lightSwitched(pet, now, state.settings, lit);
    if (dayPart(now, state.settings) === 'night') key = lit ? 'toast.lightsOnNight' : 'toast.lightsOff';
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
      if (r === 'dozed') world.effects.emit('zzz', at(), 2);
      else if (r === 'perked') world.pet?.hop();
    }
  }
  hud.toast(t(key, { name: pet.name }));
  saveGame(state);
  updateHud();
}

/**
 * At night, Feed, Play and Train wake the pet when the light is on (grumpy, see wakeAtNight); with it off they
 * let it sleep. Returns whether the pet is up for the action, and whether this just woke it.
 */
function nightWake(pet: PetState, now: number): 'up' | 'woke' | 'asleep' {
  if (!isAsleep(now, state.settings) || pet.upLate) return 'up';
  const name = { name: pet.name };
  if (!state.egg.lightsOn) {
    // How to wake it is shown once; after that it simply sleeps.
    hud.toast(t(state.learned?.lightTip ? 'toast.asleep' : 'toast.asleepLightTip', name));
    state.learned = { ...state.learned, lightTip: true };
    sfx.nope();
    return 'asleep';
  }
  const r = wakeAtNight(pet, now, state.settings);
  state.learned = { ...state.learned, nightWake: true, lightTip: true };
  hud.toast(t(r === 'mistake' ? 'toast.wokeAgain' : 'toast.wokeGrumpy', name));
  world.pet?.cower();
  return 'woke';
}

/** Evenings and nights are dark with the light off; the egg simply rests in the dark at night. */
function roomDark(now: number): boolean {
  const part = dayPart(now, state.settings);
  if (state.phase === 'egg') return part === 'night';
  return part !== 'day' && !state.egg.lightsOn;
}

// ---------- egg care ----------

function eggAction(action: DockAction) {
  if (action === 'mist') mist();
  else if (action === 'sing') sing();
  else if (action === 'turn') turn(Math.random() < 0.5 ? 1 : -1);
}

function setWarming(active: boolean) {
  unlockAudio();
  if (!eggActive()) return;
  if (active && !warming) {
    sfx.warm();
    haptic('tap');
  }
  if (!active && warming) {
    if (warmPampered > 0.5) {
      world.effects.emit('heart', world.egg.center(), 3);
      hud.toast(t('toast.pampered'));
    } else if (state.egg.warmth >= 99) hud.toast(t('toast.toasty'));
  }
  if (active) warmPampered = 0;
  warming = active;
}

/** Care beyond full is pampering: hearts and a toast, so the player learns that it counts. */
function careFeedback(r: CareResult, raisedKey: TextKey | null) {
  if (r.added > 0) {
    if (raisedKey) hud.toast(t(raisedKey));
  } else if (r.pampered > 0) {
    world.effects.emit('heart', world.egg.center(), 3);
    hud.toast(t('toast.pampered'));
  } else hud.toast(t('toast.full'));
}

function mist() {
  if (!eggActive()) return;
  const r = mistEgg(state.egg);
  world.effects.emit('drop', world.egg.center(), 12);
  world.egg.nudge(0.8);
  sfx.mist();
  haptic('tap');
  careFeedback(r, 'toast.misted');
}

function sing() {
  if (!eggActive() || singCooldown > 0) return;
  singCooldown = SING_COOLDOWN;
  const r = comfortEgg(state.egg, SING_AMOUNT);
  sfx.sing();
  for (let i = 0; i < 5; i++) {
    setTimeout(() => {
      world.effects.emit('note', world.egg.center(), 1);
      world.egg.nudge(0.7, i % 2 ? 0 : Math.PI);
    }, i * 140);
  }
  careFeedback(r, null);
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

  // At night these wake the pet if the light is on; the wake-up message then wins over the action's own.
  const night = action === 'feed' || action === 'play' || action === 'train' ? nightWake(pet, now) : 'up';
  switch (action) {
    case 'train':
      sfx.tap();
      if (night === 'woke') saveGame(state);
      sheet.open('train');
      return;
    case 'feed': {
      if (night === 'asleep') break;
      const r = feedPet(pet, now, state.settings);
      if (r === 'ok') {
        view?.eat();
        sfx.eat();
        haptic('tap');
        setTimeout(() => world.effects.emit('heart', at(), 2), 1300);
        if (night !== 'woke') hud.toast(t('toast.fed'));
      } else if (night !== 'woke') {
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
      if (night === 'asleep') break;
      const r = playWith(pet, now, state.settings);
      if (r === 'ok') {
        view?.dance();
        sfx.play();
        haptic('success');
        for (let i = 0; i < 4; i++) setTimeout(() => world.effects.emit(i % 2 ? 'note' : 'heart', at(), 1), i * 300);
        if (night !== 'woke') hud.toast(t('toast.played'));
      } else if (night !== 'woke') {
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

/** Tapping the old eggshell sweeps it away: it bursts into shards that tumble off and vanish. */
function sweepShell() {
  const pet = livePet();
  if (!pet || pet.shellSwept) return;
  const at = world.egg.shellCenter();
  pet.shellSwept = true;
  world.updateShell(0, true);
  world.effects.shatter(at, 14);
  world.effects.emit('spark', at, 8);
  sfx.crack();
  haptic('tap');
  hud.toast(t('toast.shellSwept'));
  saveGame(state);
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
      (h
        ? ` ${t('reveal.heritage', {
            parent: h.parentName,
            stats: listOf(Object.entries(h.stats).map(([s, n]) => `${t(`stat.${s as Stat}`)} +${n}`)),
          })}`
        : '');
    hud.showOverlay({
      title: t('reveal.title', { type }),
      body,
      button: t('reveal.button'),
      onClose: (name) => {
        if (cleanName(name)) pet.name = cleanName(name);
        pet.revealSeen = true;
        saveGame(state);
        updateHud();
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
    : pet.form !== 'baby'
      ? t(`evolve.why.${pet.form as Exclude<FormId, 'baby' | `adult.${string}`>}`)
      : '';
  setTimeout(
    () =>
      hud.showOverlay({
        title: t('evolve.title', { name }),
        body: `${t('evolve.body', { name, species })} ${why}`,
        button: t('evolve.button'),
        onClose: updateHud,
      }),
    1900,
  );
}

function showEnding(pet: PetState) {
  endShown = true;
  reportStats();
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
      hud.showOverlay({
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
  hud.showOverlay({
    title,
    body,
    button: t('newEgg.start'),
    onClose: (mode, checked) => then(mode as NeglectMode, checked),
    choices: {
      options: NEGLECT_MODES.map((mode) => ({ value: mode, label: t(`neglect.${mode}`) })),
      value: state.settings.neglect,
    },
    check,
  });
}

function startNewEgg() {
  // The current egg or pet's story ends here: it was replaced while still alive, or it already ended.
  const alive = state.phase === 'egg' ? !state.egg.failed : state.pet?.status === 'alive';
  reportStats(alive ? 'released' : undefined);
  chooseNeglect(t('newEgg.title'), t('newEgg.body'), (mode) => {
    layNewEgg(state, gameNow(state), undefined, mode);
    saveGame(state);
    location.reload();
  });
}

// ---------- HUD ----------

const EGG_MOODS = ['egg.mood.0', 'egg.mood.1', 'egg.mood.2', 'egg.mood.3', 'egg.mood.4'] as const satisfies readonly TextKey[];

/** Taps left to break out of the shell, for the hint and the cracks. */
const rush = () => ({ left: rushLeft, taps: RUSH_TAPS });

function formatAge(hours: number): string {
  const d = Math.floor(hours / 24);
  const h = Math.floor(hours % 24);
  return d > 0 ? t('dur.dh', { d, h }) : t('dur.h', { h });
}

function updateHud() {
  const now = gameNow(state);
  const egg = state.egg;
  if (state.phase === 'egg') {
    const stage = hatchStage(egg);
    const day = Math.floor((now - egg.laidAt) / (24 * HOUR)) + 1;
    const asleep = isAsleep(now, state.settings);
    hud.setMode(egg.failed ? 'none' : 'egg');
    const h = egg.heritage;
    hud.setHeader(
      h ? t('egg.titleFrom', { name: h.parentName }) : t('egg.title'),
      `${t('egg.day', { n: day })} · ${asleep ? t('egg.sleeping') : t(EGG_MOODS[stage])}`,
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
    const hint = eggHint(egg, now, state.settings, rush());
    hud.setHint(egg.failed ? '' : t(hint.key, hint.params), hint.urgent);
    hud.setDockState({ turn: hoursUntilTurn(egg, now) < 0.5 });
    world.egg.draw({ crack: crackLevel(egg, rush()), leaning: careLeaning(egg), failed: egg.failed });
  } else if (state.pet && !endShown) {
    const pet = state.pet;
    const stage = Math.min(pet.shownStage, LIFE_STAGES.length - 1);
    const sleeping = isSleeping(pet, now, state.settings);
    const feel = petFeel(pet, now, state.settings);
    hud.setMode('pet');
    const species = speciesName(pet.type, pet.shownForm);
    const age = t('pet.age', { age: formatAge(ageHours(pet, now)) });
    const stars = masteredStats(pet).length;
    hud.setHeader(pet.name, `${species} · ${age} · ${t(`pet.feel.${feel}`)}`, [
      { text: t(`type.${pet.type}`), tone: pet.type },
      { text: t(`life.${LIFE_STAGES[stage]}`), tone: 'neutral' },
      ...(pet.generation > 1 ? [{ text: t('gen', { n: pet.generation }), tone: 'neutral' as const }] : []),
      ...(stars ? [{ text: '★'.repeat(stars), tone: 'gold' as const }] : []),
    ]);
    hud.setNeeds({
      hunger: pet.hunger / 100,
      mood: pet.mood / 100,
      energy: pet.energy / maxEnergy(pet),
      hygiene: hygiene(pet) / 100,
    });
    const health = petHealth(pet);
    hud.setVitals(t(`pet.health.${health}`), health !== 'good', pet.discipline / 100);
    world.updateShell(ageHours(pet, now) / (SHELL_DAYS * 24), pet.shellSwept);
    const hint = petHint(pet, now, {
      settings: state.settings,
      lightsOn: state.egg.lightsOn,
      knowsNightWake: !!state.learned?.nightWake,
      tapped: petTapped,
    });
    hud.setHint(t(hint.key, hint.params), hint.urgent);
    hud.setDockState(
      {
        feed: pet.hunger < 30 && !sleeping,
        clean: pet.droppings.length > 0,
        play: pet.mood < 30 && !sleeping,
        medicine: pet.sick,
      });
    const kind = lightButtonKind(pet, now);
    const canNap = napCheck(pet, now, state.settings) === 'ok';
    hud.setLightButton(kind, {
      lit: kind === 'light' && state.egg.lightsOn,
      ready: kind === 'nap' && canNap,
      dim: kind === 'nap' && !canNap,
    });
  }

  const insets = hud.insets();
  const key = `${Math.round(insets.top)}|${Math.round(insets.bottom)}|${insets.sheet ?? false}`;
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
    stats: statsUrl
      ? {
          on: state.settings.shareStats === true,
          set: (on) => {
            state.settings.shareStats = on;
            saveGame(state);
            reportStats();
          },
        }
      : null,
    onInstall: async () => {
      await installPrompt?.prompt();
      installPrompt = null;
    },
    now: () => gameNow(state),
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
              for (const stage of LIFE_STAGES.slice(0, next)) h += stageHours(state.pet, stage);
              state.clockOffset += Math.max(0, h - ageHours(state.pet, now)) * HOUR + 60_000;
            }
            updateHud();
          },
          skyHour: (h) => (skyHour = h),
          getSkyHour: () => skyHour ?? localHour(gameNow(state)),
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
    else if (target === 'shell') sweepShell();
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

// Live battles only show up when this deployment has a relay.
const relayReady = findRelay().then((url) => (arena.relay = url));

// A friend's challenge or live invite link: open the Battle tab with their code filled in.
const challenge = params.get(CHALLENGE_PARAM) ?? params.get(LIVE_PARAM);
if (challenge) {
  const url = new URL(location.href);
  url.searchParams.delete(CHALLENGE_PARAM);
  url.searchParams.delete(LIVE_PARAM);
  history.replaceState(null, '', url);
  if (livePet()?.revealSeen) void relayReady.then(() => setTimeout(() => arena.challenge(challenge), 600));
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
      warmPampered += warmEgg(egg, WARM_PER_SECOND * dt).pampered;
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

    const sleepy = isAsleep(now, state.settings);
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
    reportStats();
    updateHud();
    hud.showOverlay({ title: t('failed.title'), body: t('failed.body'), button: t('failed.button'), onClose: startNewEgg });
  }

  const pet = state.pet;
  if (state.phase === 'hatched' && pet && world.pet) {
    if (pet.status !== 'alive') {
      if (!endShown && pet.revealSeen) showEnding(pet);
    } else {
      if (pet.stage > pet.shownStage && pet.revealSeen && !hud.overlayOpen && !sheet.isOpen) evolve(pet);
      const sleeping = isSleeping(pet, now, state.settings);
      world.pet.setLook({ sleeping, sick: pet.sick, calling: pet.call !== null && !sheet.isOpen, mood: pet.mood });
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
        hud.toast(t(key, { name: pet.name }));
        if (pet.wake === 'rested' || pet.wake === 'morning') world.pet.hop();
        sfx.toggle();
        pet.wake = null;
        saveGame(state);
      }
      world.setDroppings(pet.droppings);
      if (sleeping && Math.random() < dt / 2) world.effects.emit('zzz', world.pet.center(), 1);
    }
  }

  world.egg.update(dt, { warmth: egg.warmth, ready: rushLeft !== null });
  const lit = state.phase !== 'egg' && state.egg.lightsOn && dayPart(now, state.settings) !== 'day';
  world.render(dt, time, sunAt(skyHour ?? localHour(now), now, state.settings), { dark: roomDark(now), lamp: lit });

  hudTimer -= dt;
  if (hudTimer <= 0) {
    hudTimer = 0.2;
    updateHud();
    setMusicMode(musicFor(now, state.settings, { battle: !!world.foe, dark: roomDark(now), pet: livePet() }));
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

// ---------- pet stats (opt-in) ----------

/** Where anonymous pet stats go, if this server collects them (null until known, or when it doesn't). */
let statsUrl: string | null = null;

/** Send this pet's snapshot if the player opted in and it's due (a new day, or something changed). */
function reportStats(status?: PetEnding): void {
  if (report(statsUrl, state, __APP_VERSION__, status)) saveGame(state);
}

/** Players from before pet stats get asked once, when nothing else is on screen. */
function askAboutStats(): void {
  if (hud.overlayOpen || sheet.isOpen) {
    setTimeout(askAboutStats, 5000);
    return;
  }
  hud.showOverlay({
    title: t('stats.askTitle'),
    body: t('stats.askBody'),
    button: t('stats.ok'),
    onClose: (answer) => {
      state.settings.shareStats = answer === 'yes';
      saveGame(state);
      reportStats();
    },
    // A radio group needs a starting choice: "no", so only an active yes opts in.
    choices: { options: [{ value: 'yes', label: t('stats.yes') }, { value: 'no', label: t('stats.no') }], value: 'no' },
  });
}

const statsKnown = findStats().then((url) => {
  statsUrl = url;
  if (url && saved && state.settings.shareStats === undefined) setTimeout(askAboutStats, 3000);
  reportStats();
});
setInterval(() => reportStats(), 60_000);
document.addEventListener('visibilitychange', () => document.hidden || reportStats());

// The very first egg: welcome, choose how forgiving the game is, and (where the server collects them) whether
// to share anonymous pet stats: unticked, so only a player who ticks it shares.
if (!saved) {
  void statsKnown.then(() =>
    chooseNeglect(
      t('welcome.title'),
      t('welcome.body'),
      (mode, share) => {
        state.settings.neglect = mode;
        if (statsUrl) state.settings.shareStats = share;
        saveGame(state);
        updateHud();
        reportStats();
      },
      statsUrl ? { label: t('stats.share'), checked: false } : undefined,
    ),
  );
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // Offline support is a bonus; the game works without it.
  });
}

// ---------- updates ----------

/** A newer deploy is out: offer a reload (pages always come fresh from the server, so a reload gets it). */
function offerUpdate(version: string): void {
  const box = document.getElementById('update')!;
  document.getElementById('update-text')!.textContent =
    version === __APP_VERSION__ ? t('update.ready') : t('update.readyVersion', { version });
  const reload = document.getElementById('update-reload') as HTMLButtonElement;
  reload.textContent = t('update.reload');
  reload.onclick = () => {
    saveGame(state);
    location.reload();
  };
  const later = document.getElementById('update-later') as HTMLButtonElement;
  later.innerHTML = icon('close', 18);
  later.ariaLabel = t('update.later');
  later.onclick = () => (box.hidden = true);
  box.hidden = false;
}

if (import.meta.env.PROD) {
  const entry = new URL(import.meta.url).pathname.split('/').pop() ?? '';
  watchForUpdates({ version: __APP_VERSION__, entry }, (deployed) => offerUpdate(deployed.version));
}
