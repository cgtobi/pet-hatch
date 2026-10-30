import '@fontsource/fredoka/latin-500.css';
import '@fontsource/fredoka/latin-600.css';
import '@fontsource/nunito/latin-600.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-800.css';
import './style.css';

import { setHapticsEnabled, setMusicEnabled, setMusicMode, setSoundEnabled, suspendAudio, unlockAudio } from './feedback';
import { setLang, t, type TextKey } from './i18n';
import { attachGestures } from './input/gestures';
import { World } from './scene/world';
import { dayPart, HOUR, isAsleep, localHour } from './sim/clock';
import { sunAt } from './sim/sun';
import { careLeaning, hatchStage, hoursUntilTurn, TURN_INTERVAL_H } from './sim/egg';
import { advance, gameNow, newGame } from './sim/game';
import { ageHours, hygiene, isSleeping, LIFE_STAGES, lifeStageIndex, napCheck, SHELL_DAYS, stageHours } from './sim/pet';
import { findRelay } from './net/relayConfig';
import { CHALLENGE_PARAM } from './sim/battlecode';
import { speciesName } from './sim/evolution';
import { exportSave, importSave, loadGame, saveGame } from './sim/save';
import { masteredStats, maxEnergy } from './sim/training';
import type { GameState, PetState } from './sim/types';
import { Hud } from './ui/hud';
import { openSettings, type InstallState } from './ui/settings';
import { ActivitySheet } from './ui/sheet';
import { crackLevel, eggHint, lightButtonKind, musicFor, petFeel, petHealth, petHint, roomDark } from './ui/status';
import { LIVE_PARAM, setUpBattles } from './app/battles';
import type { Game } from './app/context';
import { createEggCare } from './app/eggCare';
import { createMoments } from './app/moments';
import { createPetCare } from './app/petCare';
import { icon } from './ui/icons';
import { watchForUpdates } from './update';
import { findStats, report, type PetEnding } from './net/stats';

const params = new URLSearchParams(location.search);
/** Debug, only on the dev server (npm run dev): run game time faster than real time, e.g. ?speed=600. */
const SPEED = import.meta.env.DEV ? Math.max(1, Number(params.get('speed')) || 1) : 1;
const DEBUG = import.meta.env.DEV && (params.has('debug') || SPEED > 1);
/** Debug: show the sky at this hour instead of the game's (the game itself keeps its own time). */
let skyHour: number | null = null;

const saved = loadGame();
const state: GameState = saved ?? newGame(Date.now());
setLang(state.settings.language);
setSoundEnabled(state.settings.sound);
setMusicEnabled(state.settings.music);
setHapticsEnabled(state.settings.haptics);
advance(state, gameNow(state));

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const world = new World(canvas, state.egg.seed);

let insetKey = '';

const hud = new Hud({
  onWarm: (active) => eggCare.setWarming(active),
  onAction: (action) => {
    unlockAudio();
    if (state.phase === 'egg') eggCare.action(action);
    else petCare.action(action);
  },
  onLightButton: () => {
    unlockAudio();
    petCare.lightButton();
  },
  onMore: () => showSettings(),
});

const sheet = new ActivitySheet(() => {
  insetKey = '';
  updateHud();
});

const eggActive = () => state.phase === 'egg' && !state.egg.failed;
const livePet = (): PetState | null => (state.phase === 'hatched' && state.pet?.status === 'alive' ? state.pet : null);

/** What the parts of the game share (see src/app/). */
const game: Game = {
  state,
  world,
  hud,
  sheet,
  now: () => gameNow(state),
  livePet,
  eggActive,
  save: () => saveGame(state),
  refresh: () => updateHud(),
  petCenter: () => world.pet?.center() ?? world.egg.center(),
};
const moments = createMoments(game, { reportStats: (status) => reportStats(status), stopWarming: () => eggCare.stopWarming() });
const eggCare = createEggCare(game, () => moments.hatchNow());
const petCare = createPetCare(game, moments);
const arena = setUpBattles(game);

// ---------- HUD ----------

const EGG_MOODS = ['egg.mood.0', 'egg.mood.1', 'egg.mood.2', 'egg.mood.3', 'egg.mood.4'] as const satisfies readonly TextKey[];

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
    const hint = eggHint(egg, now, state.settings, eggCare.rush());
    hud.setHint(egg.failed ? '' : t(hint.key, hint.params), hint.urgent);
    hud.setDockState({ turn: hoursUntilTurn(egg, now) < 0.5 });
    world.egg.draw({ crack: crackLevel(egg, eggCare.rush()), leaning: careLeaning(egg), failed: egg.failed });
  } else if (state.pet && !moments.endShown()) {
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
      tapped: petCare.tapped(),
    });
    hud.setHint(t(hint.key, hint.params), hint.urgent);
    hud.setDockState(
      {
        feed: pet.hunger < 30 && !sleeping,
        clean: pet.droppings.length > 0,
        play: pet.mood < 30 && !sleeping,
        medicine: pet.sick,
      });
    const kind = lightButtonKind(pet, now, state.settings);
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
    onNewEgg: () => moments.startNewEgg(),
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
  onWarm: (active) => eggCare.setWarming(active),
  onStroke: (px) => eggCare.stroke(px),
  onMist: () => eggCare.mist(),
  onTurn: (direction) => eggCare.turn(direction),
  onTap: (target) => {
    unlockAudio();
    if (target === 'egg') eggCare.tap();
    else if (target === 'shell') petCare.sweepShell();
    else petCare.tap();
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
    eggCare.stopWarming();
    saveGame(state);
  }
});
window.addEventListener('pagehide', () => saveGame(state));

// ---------- start ----------

if (state.phase === 'hatched' && state.pet) {
  const pet = state.pet;
  if (!pet.revealSeen) setTimeout(() => moments.burstAndReveal(pet, pet.hatchedAlone), 700);
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
  if (wasEgg && state.phase === 'hatched' && state.pet) moments.burstAndReveal(state.pet, true);

  eggCare.frame(dt, now);
  if (state.phase === 'egg' && state.egg.failed && !moments.endShown()) moments.eggFailed();
  petCare.frame(dt, now);

  world.egg.update(dt, { warmth: state.egg.warmth, ready: eggCare.rush().left !== null });
  const lit = state.phase !== 'egg' && state.egg.lightsOn && dayPart(now, state.settings) !== 'day';
  world.render(dt, time, sunAt(skyHour ?? localHour(now), now, state.settings), { dark: roomDark(state, now), lamp: lit });

  hudTimer -= dt;
  if (hudTimer <= 0) {
    hudTimer = 0.2;
    updateHud();
    setMusicMode(musicFor(now, state.settings, { battle: !!world.foe, dark: roomDark(state, now), pet: livePet() }));
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
    moments.chooseNeglect(
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
