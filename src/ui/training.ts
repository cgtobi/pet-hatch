import { t, type TextKey } from '../i18n';
import { speciesName } from '../sim/evolution';
import { LIFE_STAGES } from '../sim/pet';
import {
  grade,
  MAX_STAT,
  STATS,
  statCap,
  TRAIN_ENERGY,
  trainValue,
  type TrainCheck,
  type TrainResult,
  type TrainStat,
} from '../sim/training';
import type { PetState } from '../sim/types';
import { icon } from './icons';
import { GAMES, STAT_ICONS, type GameText, type Minigame } from './minigames';
import { esc, type ActivitySheet } from './sheet';

export interface TrainingHandlers {
  pet(): PetState;
  check(): TrainCheck;
  /** Roll for obedience; false means the pet refused (the sheet closes). */
  start(stat: TrainStat): boolean;
  hit(): void;
  miss(): void;
  finish(stat: TrainStat, score: number): TrainResult;
  /** Endurance training is still behind a feature flag (?endu=1). */
  endurance(): boolean;
}

const TONES: Record<TrainStat, string> = { power: 'ember', speed: 'amber', guard: 'tide', wits: 'violet', endurance: 'bloom' };

/** A star for each battle stat at 100; endurance has none. */
const starred = (pet: PetState, stat: TrainStat) => stat !== 'endurance' && trainValue(pet, stat) >= MAX_STAT;

/** The Training tab: stats overview, then one minigame, then the result. */
export class Training {
  private game: Minigame | null = null;
  private sheet: HTMLElement;

  constructor(
    private s: ActivitySheet,
    private h: TrainingHandlers,
  ) {
    this.sheet = s.el;
    s.register('train', () => this.menu());
    s.onClose(() => this.stopGame());
  }

  private stopGame(): void {
    this.game?.stop();
    this.game = null;
    this.s.busy = false;
  }

  /** Stats with their caps, and one button per minigame. */
  menu(): void {
    this.stopGame();
    const pet = this.h.pet();
    const check = this.h.check();
    const cap = statCap(pet);
    const stage = Math.min(pet.stage, LIFE_STAGES.length - 1);
    const sub = `${speciesName(pet.type, pet.form)} · ${t(`life.${LIFE_STAGES[stage]}`)}`;
    const trainable: TrainStat[] = this.h.endurance() ? [...STATS, 'endurance'] : STATS;
    const rows = trainable.map((stat) => {
      const v = trainValue(pet, stat);
      const maxed = cap > 0 && v >= cap;
      const disabled = check !== 'ok' || maxed;
      return `<button type="button" class="train-row" data-stat="${stat}" ${disabled ? 'disabled' : ''}>
        <span class="bubble ${TONES[stat]}-btn">${icon(STAT_ICONS[stat], 22)}</span>
        <span class="train-row-main">
          <span class="train-row-top">
            <b>${t(`stat.${stat}`)}</b><span class="muted">${t(`game.${stat}`)}</span>
            <span class="train-val">${maxed ? `${starred(pet, stat) ? '<span class="star">★</span> ' : ''}${t('train.max')}` : `${v} / ${cap}`}</span>
          </span>
          <span class="track"><span class="fill ${TONES[stat]}-fill" style="width:${cap ? (v / cap) * 100 : 0}%"></span></span>
        </span>
        <span class="train-go">${icon('play', 18)}</span>
      </button>`;
    }).join('');
    const note = check === 'ok' ? t('train.cost', { n: TRAIN_ENERGY }) : t(`train.no.${check}`, { name: pet.name });
    this.sheet.innerHTML = `${this.s.head({ tab: 'train', sub, closeLabel: t('train.close') })}
      <p class="train-goal">${t(`train.goal.${Math.max(1, stage)}` as TextKey)}</p>
      <div class="train-rows">${rows}</div>
      <p class="train-note ${check === 'ok' ? '' : 'bad'}">${esc(note)}</p>`;
    this.s.bindHead();
    this.sheet.querySelectorAll<HTMLButtonElement>('.train-row').forEach((b) =>
      b.addEventListener('click', () => {
        const stat = b.dataset.stat as TrainStat;
        if (this.h.start(stat)) this.intro(stat);
        else this.s.close();
      }),
    );
    this.s.layout();
  }

  /** How to play, and a start button, so the game never begins before the player is ready. */
  private intro(stat: TrainStat): void {
    this.sheet.innerHTML = `${this.s.head({ title: t(`game.${stat}`), sub: t(`stat.${stat}`), closeLabel: t('train.quit') })}
      <div class="track mg-progress"><div class="fill ${TONES[stat]}-fill"></div></div>
      <div class="mg-area mg-${stat}">
        <div class="mg-intro">
          <span class="bubble ${TONES[stat]}-btn">${icon(STAT_ICONS[stat], 34)}</span>
          <p>${t(`game.${stat}.how`)}</p>
          <button type="button" class="primary mg-start">${t('train.start')}</button>
        </div>
      </div>`;
    this.s.bindHead(() => this.menu());
    this.sheet.querySelector('.mg-start')!.addEventListener('click', () => this.play(stat));
    this.s.layout();
  }

  private play(stat: TrainStat): void {
    const area = this.sheet.querySelector<HTMLElement>('.mg-area')!;
    const bar = this.sheet.querySelector<HTMLElement>('.mg-progress .fill')!;
    const sub = this.sheet.querySelector<HTMLElement>('.train-sub')!;
    const text: GameText = {
      round: (n, of) => t('game.round', { n, of }),
      ready: t('game.ready'),
      tap: t('game.tap'),
      watch: t('game.watch'),
      yourTurn: t('game.yourTurn'),
    };
    area.replaceChildren();
    this.s.busy = true;
    this.game = GAMES[stat](
      area,
      {
        hit: () => this.h.hit(),
        miss: () => this.h.miss(),
        progress: (f) => (bar.style.width = `${Math.round(f * 100)}%`),
        status: (s) => (sub.textContent = s),
      },
      text,
    );
    const game = this.game;
    void game.done.then((score) => {
      if (this.game !== game) return;
      this.game = null;
      this.s.busy = false;
      this.result(stat, score, this.h.finish(stat, score));
    });
  }

  private result(stat: TrainStat, score: number, r: TrainResult): void {
    const name = t(`stat.${stat}`);
    const again = this.h.check() === 'ok' && !r.capped;
    const gain = r.gain > 0 ? `<p class="train-gain ${TONES[stat]}">${t('train.gain', { stat: name, n: r.gain })}</p>` : '';
    const pet = this.h.pet();
    const capped = r.capped
      ? `<p class="train-goal">${t(starred(pet, stat) ? 'train.star' : 'train.capped', { stat: name })}</p>`
      : '';
    this.sheet.innerHTML = `<div class="train-result">
        <span class="bubble ${TONES[stat]}-btn">${icon(STAT_ICONS[stat], 34)}</span>
        <h2>${t(`train.grade.${grade(score)}`)}</h2>
        <p class="muted">${t('train.score', { n: Math.round(score * 100) })}</p>
        ${gain}${capped}
        <div class="train-actions">
          <button type="button" class="secondary train-again" ${again ? '' : 'disabled'}>${t('train.again')}</button>
          <button type="button" class="primary train-done">${t('train.done')}</button>
        </div>
      </div>`;
    this.sheet.querySelector('.train-done')!.addEventListener('click', () => this.menu());
    this.sheet.querySelector('.train-again')!.addEventListener('click', () => {
      if (this.h.start(stat)) this.intro(stat);
      else this.s.close();
    });
    this.s.layout();
  }
}
