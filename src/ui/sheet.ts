import { t } from '../i18n';
import { icon } from './icons';

export type Tab = 'train' | 'battle';

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The bottom sheet shared by Training and Battle. It hides the status card and dock while open
 * (they fade out while the camera glides back and up to keep the island in view), and offers tabs between the
 * two menus.
 */
export class ActivitySheet {
  readonly root = document.getElementById('activity')!;
  readonly el = this.root.querySelector<HTMLElement>('.sheet')!;
  /** A minigame or battle is running: tapping the backdrop must not close the sheet. */
  busy = false;
  private views = new Map<Tab, () => void>();
  private closeListeners: (() => void)[] = [];

  constructor(private relayout: () => void) {
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root && !this.busy) this.close();
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  register(tab: Tab, view: () => void): void {
    this.views.set(tab, view);
  }

  onClose(fn: () => void): void {
    this.closeListeners.push(fn);
  }

  open(tab: Tab): void {
    this.root.hidden = false;
    document.body.classList.add('sheet-open');
    this.show(tab);
  }

  show(tab: Tab): void {
    this.views.get(tab)!();
  }

  close(): void {
    this.busy = false;
    for (const fn of this.closeListeners) fn();
    this.root.hidden = true;
    document.body.classList.remove('sheet-open');
    this.relayout();
  }

  layout(): void {
    this.relayout();
  }

  /** Header with either the tabs (menus) or a title (games and battles), and an optional close button. */
  head(opts: { tab?: Tab; title?: string; sub: string; closeLabel?: string }): string {
    const tabs = (['train', 'battle'] as const)
      .map((tab) => `<button type="button" role="tab" data-tab="${tab}" aria-selected="${tab === opts.tab}">${t(`tab.${tab}`)}</button>`)
      .join('');
    const top = opts.tab ? `<div class="tabs" role="tablist">${tabs}</div>` : `<h2>${esc(opts.title ?? '')}</h2>`;
    const close = opts.closeLabel
      ? `<button type="button" class="round sheet-close" aria-label="${esc(opts.closeLabel)}">${icon('close', 20)}</button>`
      : '';
    return `<div class="train-head">
      <div class="train-head-main">${top}<p class="muted train-sub">${esc(opts.sub)}</p></div>
      ${close}
    </div>`;
  }

  /** Wire up the header rendered by head(): the close button and tab switches. */
  bindHead(onClose: () => void = () => this.close()): void {
    this.el.querySelector('.sheet-close')?.addEventListener('click', onClose);
    this.el.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        if (b.getAttribute('aria-selected') !== 'true') this.show(b.dataset.tab as Tab);
      }),
    );
  }
}
