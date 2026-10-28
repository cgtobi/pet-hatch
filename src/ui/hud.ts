import { t } from '../i18n';
import type { Leaning } from '../sim/egg';
import { icon, type IconName } from './icons';

export type DockAction = 'mist' | 'sing' | 'turn' | 'lights';
export type NeedKey = 'warmth' | 'humidity' | 'bond' | 'turn';

export interface HudHandlers {
  onWarm(active: boolean): void;
  onAction(action: DockAction): void;
  onMore(): void;
}

const NEEDS: { key: NeedKey; icon: IconName; color: string; ink: string }[] = [
  { key: 'warmth', icon: 'flame', color: 'var(--ember)', ink: 'var(--ember-ink)' },
  { key: 'humidity', icon: 'drop', color: 'var(--tide)', ink: 'var(--tide-ink)' },
  { key: 'bond', icon: 'heart', color: 'var(--bloom)', ink: 'var(--bloom-ink)' },
  { key: 'turn', icon: 'turn', color: 'var(--amber)', ink: 'var(--amber-ink)' },
];

const DOCK: { id: 'warm' | DockAction; icon: IconName; tone: string }[] = [
  { id: 'warm', icon: 'flame', tone: 'ember-btn' },
  { id: 'mist', icon: 'drop', tone: 'tide-btn' },
  { id: 'sing', icon: 'note', tone: 'bloom-btn' },
  { id: 'turn', icon: 'turn', tone: 'amber-btn' },
  { id: 'lights', icon: 'moon', tone: 'violet-btn' },
];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** The DOM overlay: status card, hint chip, toast, care dock and the reveal sheet. */
export class Hud {
  private title = $('title');
  private subtitle = $('subtitle');
  private stages = $('stages');
  private needs = $('needs');
  private leaning = $('leaning');
  private hint = $('hint');
  private toastEl = $('toast');
  private dock = $('dock');
  private overlay = $('overlay');
  private more = $<HTMLButtonElement>('btn-more');
  private dockButtons = new Map<string, HTMLButtonElement>();
  private needEls = new Map<NeedKey, { root: HTMLElement; fill: HTMLElement; label: HTMLElement }>();
  private toastTimer = 0;
  private overlayClose: (() => void) | null = null;

  constructor(handlers: HudHandlers) {
    this.more.innerHTML = icon('dots', 22);
    this.more.addEventListener('click', () => handlers.onMore());
    $('overlay-button').addEventListener('click', () => {
      const close = this.overlayClose;
      this.hideOverlay();
      close?.();
    });

    for (let i = 0; i < 5; i++) {
      const s = document.createElement('div');
      s.className = 'stage';
      s.innerHTML = '<div class="stage-bar"></div><span class="stage-label"></span>';
      this.stages.append(s);
    }

    for (const n of NEEDS) {
      const root = document.createElement('div');
      root.className = 'need';
      root.innerHTML = `<div class="need-label"><span style="color:${n.ink}; display:flex">${icon(n.icon, 14)}</span><span></span></div><div class="track"><div class="fill" style="background:${n.color}"></div></div>`;
      this.needs.append(root);
      this.needEls.set(n.key, {
        root,
        fill: root.querySelector('.fill')!,
        label: root.querySelector('.need-label > span:last-child')!,
      });
    }

    for (const d of DOCK) {
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
    $('scene').setAttribute('aria-label', t('aria.scene'));
    $('status').setAttribute('aria-label', t('aria.status'));
    this.dock.setAttribute('aria-label', t('aria.dock'));
    $('lean-title').textContent = t('lean.title');
    this.stages.querySelectorAll('.stage-label').forEach((el, i) => {
      el.textContent = t(`stage.${i}` as 'stage.0');
    });
    for (const [key, els] of this.needEls) els.label.textContent = t(`need.${key}`);
    for (const [id, b] of this.dockButtons) b.querySelector('.label')!.textContent = t(`action.${id}` as 'action.warm');
  }

  setHeader(title: string, subtitle: string): void {
    this.title.textContent = title;
    this.subtitle.textContent = subtitle;
  }

  /** Highlight a hatch stage; null hides the row. */
  setStage(index: number | null): void {
    this.stages.hidden = index === null;
    if (index === null) return;
    [...this.stages.children].forEach((el, i) => {
      el.classList.toggle('done', i < index);
      el.classList.toggle('current', i === index);
    });
    this.stages.setAttribute('aria-label', t(`stage.${index}` as 'stage.0'));
  }

  /** Values 0…1; null hides the meters. */
  setNeeds(values: Record<NeedKey, number> | null): void {
    this.needs.hidden = values === null;
    if (!values) return;
    for (const [key, els] of this.needEls) {
      const v = values[key];
      els.fill.style.width = `${Math.round(v * 100)}%`;
      els.root.classList.toggle('low', v < 0.2);
    }
  }

  setLeaning(lean: Leaning | null): void {
    this.leaning.hidden = lean === null;
    if (!lean) return;
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

  setHint(text: string, urgent = false): void {
    if (this.hint.textContent !== text) this.hint.textContent = text;
    this.hint.classList.toggle('urgent', urgent);
  }

  setDock(visible: boolean, state: { turnDue?: boolean; lightsOn?: boolean } = {}): void {
    if (!visible) {
      this.dock.replaceChildren();
      return;
    }
    if (!this.dock.children.length) this.dock.append(...this.dockButtons.values());
    this.dockButtons.get('turn')!.classList.toggle('alert', !!state.turnDue);
    this.dockButtons.get('lights')!.classList.toggle('on', state.lightsOn === false);
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 1400);
  }

  showOverlay(title: string, body: string, button: string, onClose: () => void): void {
    $('overlay-title').textContent = title;
    $('overlay-body').textContent = body;
    $('overlay-button').textContent = button;
    this.overlayClose = onClose;
    this.overlay.hidden = false;
  }

  hideOverlay(): void {
    this.overlay.hidden = true;
    this.overlayClose = null;
  }

  get overlayOpen(): boolean {
    return !this.overlay.hidden;
  }

  /** Screen space covered by the status card (top) and dock (bottom), for framing the 3D view. */
  insets(): { top: number; bottom: number } {
    const status = $('status').getBoundingClientRect();
    const dock = this.dock.getBoundingClientRect();
    const h = window.innerHeight;
    return { top: status.bottom + 8, bottom: dock.height ? h - dock.top + 56 : 56 };
  }
}
