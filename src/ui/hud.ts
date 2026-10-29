import { t, type TextKey } from '../i18n';
import type { Leaning } from '../sim/egg';
import { icon, type IconName } from './icons';

export type HudMode = 'egg' | 'pet' | 'none';
export type EggAction = 'mist' | 'sing' | 'turn' | 'lights';
export type PetAction = 'feed' | 'clean' | 'play' | 'train' | 'medicine' | 'scold';
export type DockAction = EggAction | PetAction;
export type NeedKey = 'warmth' | 'humidity' | 'bond' | 'turn' | 'hunger' | 'mood' | 'energy' | 'hygiene';

export interface HudHandlers {
  onWarm(active: boolean): void;
  onAction(action: DockAction): void;
  onMore(): void;
}

interface NeedDef {
  key: NeedKey;
  icon: IconName;
  color: string;
  ink: string;
}

const EGG_NEEDS: NeedDef[] = [
  { key: 'warmth', icon: 'flame', color: 'var(--ember)', ink: 'var(--ember-ink)' },
  { key: 'humidity', icon: 'drop', color: 'var(--tide)', ink: 'var(--tide-ink)' },
  { key: 'bond', icon: 'heart', color: 'var(--bloom)', ink: 'var(--bloom-ink)' },
  { key: 'turn', icon: 'turn', color: 'var(--amber)', ink: 'var(--amber-ink)' },
];

const PET_NEEDS: NeedDef[] = [
  { key: 'hunger', icon: 'apple', color: '#f0603e', ink: '#b5321e' },
  { key: 'mood', icon: 'smile', color: '#ee8fb1', ink: '#c2457a' },
  { key: 'energy', icon: 'bolt', color: 'var(--amber)', ink: 'var(--amber-ink)' },
  { key: 'hygiene', icon: 'sparkle', color: 'var(--tide)', ink: 'var(--tide-ink)' },
];

interface DockDef {
  id: 'warm' | DockAction;
  icon: IconName;
  tone: string;
}

const EGG_DOCK: DockDef[] = [
  { id: 'warm', icon: 'flame', tone: 'ember-btn' },
  { id: 'mist', icon: 'drop', tone: 'tide-btn' },
  { id: 'sing', icon: 'note', tone: 'bloom-btn' },
  { id: 'turn', icon: 'turn', tone: 'amber-btn' },
  { id: 'lights', icon: 'moon', tone: 'violet-btn' },
];

const PET_DOCK: DockDef[] = [
  { id: 'feed', icon: 'apple', tone: 'ember-btn' },
  { id: 'clean', icon: 'sparkle', tone: 'tide-btn' },
  { id: 'play', icon: 'ball', tone: 'bloom-btn' },
  { id: 'train', icon: 'dumbbell', tone: 'rose-btn' },
  { id: 'medicine', icon: 'pill', tone: 'amber-btn' },
  { id: 'scold', icon: 'scold', tone: 'violet-btn' },
];

export interface Chip {
  text: string;
  tone: 'ember' | 'tide' | 'bloom' | 'astral' | 'neutral';
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** The DOM overlay: status card, hint chip, toast, care dock and the reveal sheet. */
export class Hud {
  private title = $('title');
  private subtitle = $('subtitle');
  private chips = $('chips');
  private stages = $('stages');
  private needs = $('needs');
  private leaning = $('leaning');
  private vitals = $('vitals');
  private hint = $('hint');
  private toastEl = $('toast');
  private dock = $('dock');
  private overlay = $('overlay');
  private more = $<HTMLButtonElement>('btn-more');
  private lights = $<HTMLButtonElement>('btn-lights');
  private input = $<HTMLInputElement>('overlay-input');
  private dockButtons = new Map<string, HTMLButtonElement>();
  private needEls = new Map<NeedKey, { root: HTMLElement; fill: HTMLElement; label: HTMLElement }>();
  private mode: HudMode | null = null;
  private toastTimer = 0;
  private overlayClose: ((value: string) => void) | null = null;

  constructor(handlers: HudHandlers) {
    this.more.innerHTML = icon('dots', 22);
    this.more.addEventListener('click', () => handlers.onMore());
    this.lights.innerHTML = icon('moon', 22);
    this.lights.addEventListener('click', () => handlers.onAction('lights'));
    const closeOverlay = () => {
      const close = this.overlayClose;
      const value = this.input.value.trim();
      this.hideOverlay();
      close?.(value);
    };
    $('overlay-button').addEventListener('click', closeOverlay);
    this.input.addEventListener('keydown', (e) => e.key === 'Enter' && closeOverlay());

    for (let i = 0; i < 5; i++) {
      const s = document.createElement('div');
      s.className = 'stage';
      s.innerHTML = '<div class="stage-bar"></div><span class="stage-label"></span>';
      this.stages.append(s);
    }

    for (const n of [...EGG_NEEDS, ...PET_NEEDS]) {
      const root = document.createElement('div');
      root.className = 'need';
      root.innerHTML = `<div class="need-label"><span style="color:${n.ink}; display:flex">${icon(n.icon, 14)}</span><span></span></div><div class="track"><div class="fill" style="background:${n.color}"></div></div>`;
      this.needEls.set(n.key, {
        root,
        fill: root.querySelector('.fill')!,
        label: root.querySelector('.need-label > span:last-child')!,
      });
    }

    for (const d of [...EGG_DOCK, ...PET_DOCK]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `<span class="bubble ${d.tone}">${icon(d.icon)}<span class="dot"></span></span><span class="label"></span>`;
      if (d.id === 'warm') {
        const stop = () => {
          if (!b.classList.contains('held')) return;
          b.classList.remove('held');
          handlers.onWarm(false);
        };
        b.addEventListener('pointerdown', (e) => {
          b.setPointerCapture(e.pointerId);
          b.classList.add('held');
          handlers.onWarm(true);
        });
        b.addEventListener('pointerup', stop);
        b.addEventListener('pointercancel', stop);
        b.addEventListener('contextmenu', (e) => e.preventDefault());
      } else {
        const action = d.id;
        b.addEventListener('click', () => handlers.onAction(action));
      }
      this.dockButtons.set(d.id, b);
    }
    this.applyLanguage();
  }

  /** Re-render every fixed label in the current language. */
  applyLanguage(): void {
    this.more.setAttribute('aria-label', t('aria.more'));
    this.lights.setAttribute('aria-label', t('action.lights'));
    $('scene').setAttribute('aria-label', t('aria.scene'));
    $('status').setAttribute('aria-label', t('aria.status'));
    this.dock.setAttribute('aria-label', t('aria.dock'));
    $('lean-title').textContent = t('lean.title');
    $('discipline-label').textContent = t('pet.discipline');
    this.stages.querySelectorAll('.stage-label').forEach((el, i) => {
      el.textContent = t(`stage.${i}` as TextKey);
    });
    for (const [key, els] of this.needEls) els.label.textContent = t(`need.${key}`);
    for (const [id, b] of this.dockButtons) b.querySelector('.label')!.textContent = t(`action.${id}` as TextKey);
  }

  /** Switch the meters and dock between egg care, pet care, and nothing (game over screens). */
  setMode(mode: HudMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    const needs = mode === 'egg' ? EGG_NEEDS : mode === 'pet' ? PET_NEEDS : [];
    const dock = mode === 'egg' ? EGG_DOCK : mode === 'pet' ? PET_DOCK : [];
    this.needs.replaceChildren(...needs.map((n) => this.needEls.get(n.key)!.root));
    this.dock.replaceChildren(...dock.map((d) => this.dockButtons.get(d.id)!));
    this.dock.style.setProperty('--cols', String(dock.length || 5));
    this.needs.hidden = mode === 'none';
    this.stages.hidden = mode !== 'egg';
    this.leaning.hidden = mode !== 'egg';
    this.vitals.hidden = mode !== 'pet';
    this.lights.hidden = mode !== 'pet';
    if (mode !== 'pet') this.chips.replaceChildren();
  }

  setHeader(title: string, subtitle: string, chips: Chip[] = []): void {
    this.title.textContent = title;
    this.subtitle.textContent = subtitle;
    const key = chips.map((c) => c.tone + c.text).join('|');
    if (this.chips.dataset.key !== key) {
      this.chips.dataset.key = key;
      this.chips.replaceChildren(
        ...chips.map((c) => Object.assign(document.createElement('span'), { className: `chip ${c.tone}`, textContent: c.text })),
      );
    }
  }

  /** Highlight a hatch stage. */
  setStage(index: number): void {
    [...this.stages.children].forEach((el, i) => {
      el.classList.toggle('done', i < index);
      el.classList.toggle('current', i === index);
    });
    this.stages.setAttribute('aria-label', t(`stage.${index}` as TextKey));
  }

  /** Values 0…1 for the meters of the current mode. */
  setNeeds(values: Partial<Record<NeedKey, number>>): void {
    for (const [key, v] of Object.entries(values) as [NeedKey, number][]) {
      const els = this.needEls.get(key)!;
      els.fill.style.width = `${Math.round(v * 100)}%`;
      els.root.classList.toggle('low', v < 0.2);
    }
  }

  setLeaning(lean: Leaning): void {
    const unknown = lean.label === 'Unknown';
    $('lean-ember').style.width = unknown ? '0' : `${lean.ember * 100}%`;
    $('lean-tide').style.width = unknown ? '0' : `${lean.tide * 100}%`;
    $('lean-bloom').style.width = unknown ? '0' : `${lean.bloom * 100}%`;
    const label = $('lean-label');
    label.textContent = t(`lean.${lean.label}`);
    label.style.color =
      lean.label === 'Ember'
        ? 'var(--ember-ink)'
        : lean.label === 'Tide'
          ? 'var(--tide-ink)'
          : lean.label === 'Bloom'
            ? 'var(--bloom-ink)'
            : 'var(--muted)';
  }

  setVitals(health: string, unwell: boolean, discipline: number): void {
    const h = $('health');
    h.textContent = health;
    h.classList.toggle('bad', unwell);
    $('discipline-fill').style.width = `${Math.round(discipline * 100)}%`;
  }

  setHint(text: string, urgent = false): void {
    if (this.hint.textContent !== text) this.hint.textContent = text;
    this.hint.classList.toggle('urgent', urgent);
  }

  /** Red dots on dock buttons that need attention, and the lights toggle state. */
  setDockState(alerts: Partial<Record<DockAction, boolean>>, lightsOn: boolean): void {
    for (const [id, b] of this.dockButtons) b.classList.toggle('alert', !!alerts[id as DockAction]);
    this.dockButtons.get('lights')!.classList.toggle('on', !lightsOn);
    this.lights.classList.toggle('on', !lightsOn);
    this.lights.setAttribute('aria-pressed', String(!lightsOn));
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 1600);
  }

  /** A bottom sheet with one button; pass `field` to also ask for a short text (e.g. a name). */
  showOverlay(
    title: string,
    body: string,
    button: string,
    onClose: (value: string) => void,
    field?: { label: string; value: string },
  ): void {
    $('overlay-title').textContent = title;
    $('overlay-body').textContent = body;
    $('overlay-button').textContent = button;
    $('overlay-field').hidden = !field;
    if (field) {
      $('overlay-label').textContent = field.label;
      this.input.value = field.value;
    }
    this.overlayClose = onClose;
    this.overlay.hidden = false;
  }

  hideOverlay(): void {
    this.overlay.hidden = true;
    this.overlayClose = null;
    this.input.blur();
  }

  get overlayOpen(): boolean {
    return !this.overlay.hidden;
  }

  /** Screen space covered by the status card (top) and dock (bottom), for framing the 3D view. */
  insets(): { top: number; bottom: number } {
    const status = $('status').getBoundingClientRect();
    const dock = this.dock.getBoundingClientRect();
    const h = window.innerHeight;
    const top = status.height ? status.bottom + 8 : 16;
    // The training sheet replaces the status card and dock; keep the pet visible above it.
    const sheet = document.querySelector('#training:not([hidden]) .sheet');
    if (sheet) return { top, bottom: h - sheet.getBoundingClientRect().top + 8 };
    return { top, bottom: dock.height ? h - dock.top + 56 : 56 };
  }
}
