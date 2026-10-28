import { t } from '../i18n';
import type { NeglectMode, Settings } from '../sim/types';
import { icon } from './icons';

export interface InstallState {
  /** The browser offered an install prompt we can trigger (Chrome, Edge, Android). */
  canPrompt: boolean;
  /** Already running as an installed app. */
  standalone: boolean;
  /** iOS Safari: install only via Share › Add to Home Screen. */
  ios: boolean;
}

export interface SettingsHandlers {
  onChange(patch: Partial<Settings>): void;
  /** Returns the save code, already copied to the clipboard if possible. */
  onExport(): Promise<string>;
  onImport(code: string): boolean;
  onNewEgg(): void;
  onInstall(): void;
  debug: null | { skip(hours: number): void; readyNow(): void };
}

const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

/** Builds the settings sheet from scratch each time it opens (cheap, and picks up language changes). */
export function openSettings(
  dialog: HTMLDialogElement,
  settings: Settings,
  install: InstallState,
  h: SettingsHandlers,
): void {
  const render = () => {
    const close = el('button', { type: 'button', className: 'round', ariaLabel: t('settings.done') });
    close.innerHTML = icon('close', 20);
    close.onclick = () => dialog.close();

    const segmented = <T extends string>(options: T[], value: T, label: (o: T) => string, pick: (o: T) => void) => {
      const wrap = el('div', { className: 'segmented' });
      for (const o of options) {
        const b = el('button', { type: 'button' }, label(o));
        b.setAttribute('aria-pressed', String(o === value));
        b.onclick = () => {
          pick(o);
          render();
        };
        wrap.append(b);
      }
      return wrap;
    };

    const language = el(
      'div',
      { className: 'field' },
      el('span', { className: 'field-title' }, t('settings.language')),
      segmented(['auto', 'en', 'de'] as const satisfies Settings['language'][], settings.language, (o) => t(`lang.${o}`), (o) => {
        settings.language = o;
        h.onChange({ language: o });
      }),
    );

    const neglect = el('fieldset', { className: 'field' }, el('legend', {}, t('settings.neglect')));
    for (const mode of ['cozy', 'gentle', 'classic'] as NeglectMode[]) {
      const input = el('input', { type: 'radio', name: 'neglect', value: mode, checked: settings.neglect === mode });
      input.onchange = () => {
        settings.neglect = mode;
        h.onChange({ neglect: mode });
      };
      neglect.append(el('label', { className: 'choice' }, input, t(`neglect.${mode}`)));
    }

    const hourSelect = (value: number, pick: (v: number) => void, label: string) => {
      const s = el('select', { ariaLabel: label });
      for (let i = 0; i < 24; i++) s.append(el('option', { value: String(i), selected: i === value }, hourLabel(i)));
      s.onchange = () => pick(Number(s.value));
      return el('label', { className: 'choice' }, label, s);
    };
    const sleep = el(
      'div',
      { className: 'field' },
      el('span', { className: 'field-title' }, t('settings.sleep')),
      el(
        'div',
        { className: 'row' },
        hourSelect(settings.sleepStart, (v) => h.onChange({ sleepStart: (settings.sleepStart = v) }), t('settings.sleepFrom')),
        hourSelect(settings.sleepEnd, (v) => h.onChange({ sleepEnd: (settings.sleepEnd = v) }), t('settings.sleepTo')),
      ),
      el('small', {}, t('settings.sleepHint')),
    );

    const soundInput = el('input', { type: 'checkbox', checked: settings.sound });
    soundInput.onchange = () => h.onChange({ sound: (settings.sound = soundInput.checked) });
    const sound = el('label', { className: 'choice' }, soundInput, t('settings.sound'));

    const app = el('div', { className: 'field' }, el('span', { className: 'field-title' }, t('settings.app')));
    if (install.standalone) app.append(el('small', {}, t('settings.installed')));
    else if (install.canPrompt) {
      const b = el('button', { type: 'button', className: 'secondary' }, t('settings.install'));
      b.onclick = () => h.onInstall();
      app.append(el('div', { className: 'row' }, b));
    } else app.append(el('small', {}, t(install.ios ? 'settings.installIos' : 'settings.installOther')));

    const code = el('textarea', { placeholder: t('settings.importPlaceholder'), spellcheck: false });
    const exportBtn = el('button', { type: 'button', className: 'secondary' }, t('settings.export'));
    exportBtn.onclick = async () => {
      code.value = await h.onExport();
      code.select();
    };
    const importBtn = el('button', { type: 'button', className: 'secondary' }, t('settings.import'));
    code.oninput = () => code.setCustomValidity('');
    importBtn.onclick = () => {
      if (h.onImport(code.value)) return dialog.close();
      code.setCustomValidity(t('toast.importFailed'));
      code.reportValidity();
    };
    const backup = el(
      'div',
      { className: 'field' },
      el('span', { className: 'field-title' }, t('settings.backup')),
      el('small', {}, t('settings.backupHint')),
      code,
      el('div', { className: 'row' }, exportBtn, importBtn),
    );

    const newEgg = el('button', { type: 'button', className: 'secondary' }, t('settings.newEgg'));
    newEgg.onclick = () => {
      if (confirm(t('settings.newEggConfirm'))) {
        dialog.close();
        h.onNewEgg();
      }
    };

    const body = el(
      'div',
      { className: 'settings-body' },
      el('div', { className: 'settings-head' }, el('h2', { id: 'settings-title' }, t('settings.title')), close),
      language,
      neglect,
      sleep,
      sound,
      app,
      backup,
      el('div', { className: 'row' }, newEgg),
    );

    if (h.debug) {
      const dbg = h.debug;
      const btn = (label: string, fn: () => void) => {
        const b = el('button', { type: 'button', className: 'secondary' }, label);
        b.onclick = fn;
        return b;
      };
      body.append(
        el(
          'div',
          { className: 'field' },
          el('span', { className: 'field-title' }, t('settings.debug')),
          el(
            'div',
            { className: 'row' },
            btn(t('debug.skip1'), () => dbg.skip(1)),
            btn(t('debug.skip6'), () => dbg.skip(6)),
            btn(t('debug.ready'), () => dbg.readyNow()),
          ),
        ),
      );
    }
    dialog.replaceChildren(body);
  };

  render();
  if (!dialog.open) dialog.showModal();
}
