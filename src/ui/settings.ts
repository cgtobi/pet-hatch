import { canVibrate } from '../feedback';
import { LANGUAGE_NAMES, LANGUAGES, t } from '../i18n';
import { BATTLE_ENERGY } from '../sim/battle';
import { STAT_CAPS, TRAIN_ENERGY } from '../sim/training';
import { speciesName } from '../sim/evolution';
import type { Ancestor, Settings } from '../sim/types';
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
  /** Earlier pets, oldest first. */
  family: Ancestor[];
  onChange(patch: Partial<Settings>): void;
  /** Returns the save code, already copied to the clipboard if possible. */
  onExport(): Promise<string>;
  onImport(code: string): boolean;
  onNewEgg(): void;
  onInstall(): void;
  /** Anonymous pet stats, where the server collects them (null otherwise: nothing to switch). */
  stats: null | { on: boolean; set(on: boolean): void };
  /** Current game time, which runs ahead of the real clock after debug skips or with ?speed=. */
  now(): number;
  debug: null | {
    skip(hours: number): void;
    readyNow(): void;
    /** Show the sky at this hour; null follows the game's clock again. */
    skyHour(h: number | null): void;
    getSkyHour(): number;
  };
}

const HELP_TOPICS = ['egg', 'types', 'care', 'calls', 'mistakes', 'life', 'train', 'evolve', 'battle', 'modes'] as const;

const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

const clockLabel = (t: number) =>
  new Date(t).toLocaleString(document.documentElement.lang || undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

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

    const languageSelect = el('select', { ariaLabel: t('settings.language') });
    for (const code of ['auto', ...LANGUAGES] as Settings['language'][]) {
      const label = code === 'auto' ? t('lang.auto') : LANGUAGE_NAMES[code];
      languageSelect.append(el('option', { value: code, selected: settings.language === code }, label));
    }
    languageSelect.onchange = () => {
      settings.language = languageSelect.value as Settings['language'];
      h.onChange({ language: settings.language });
      render();
    };
    const language = el(
      'label',
      { className: 'field' },
      el('span', { className: 'field-title' }, t('settings.language')),
      languageSelect,
    );

    // Fixed for the current egg and pet: it is chosen when a new egg is started, so only the choice shows here.
    const neglect = el(
      'div',
      { className: 'field' },
      el('span', { className: 'field-title' }, t('settings.neglect')),
      el('span', { className: 'field-value' }, t(`neglect.${settings.neglect}`)),
      el('small', {}, t('settings.neglectLocked')),
    );

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

    // Collapsed topics; each body line becomes a bullet.
    // One collapsed "How to play" entry holding the topics, so the settings themselves stay in view.
    const topics = el('div', { className: 'help-topics' });
    const help = el('details', { className: 'help help-all' }, el('summary', {}, t('help.title')), topics);
    const params = { energy: TRAIN_ENERGY, battleEnergy: BATTLE_ENERGY, child: STAT_CAPS[1], teen: STAT_CAPS[2], adult: STAT_CAPS[3] };
    for (const topic of HELP_TOPICS) {
      const lines = t(`help.${topic}.body`, params).split('\n');
      topics.append(
        el(
          'details',
          { className: 'help' },
          el('summary', {}, t(`help.${topic}.title`)),
          el('ul', {}, ...lines.map((line) => el('li', {}, line))),
        ),
      );
    }

    const toggle = (key: 'sound' | 'music' | 'haptics') => {
      const input = el('input', { type: 'checkbox', checked: settings[key] });
      input.onchange = () => h.onChange({ [key]: (settings[key] = input.checked) });
      return el('label', { className: 'choice' }, input, t(`settings.${key}`));
    };
    const sound = el('div', { className: 'field' }, toggle('sound'), toggle('music'));
    if (canVibrate) sound.append(toggle('haptics'));

    const app = el('div', { className: 'field' }, el('span', { className: 'field-title' }, t('settings.app')));
    if (install.standalone) app.append(el('small', {}, t('settings.installed')));
    else if (install.canPrompt) {
      const b = el('button', { type: 'button', className: 'secondary' }, t('settings.install'));
      b.onclick = () => h.onInstall();
      app.append(el('div', { className: 'row' }, b));
    } else app.append(el('small', {}, t(install.ios ? 'settings.installIos' : 'settings.installOther')));
    if (h.stats) {
      const stats = h.stats;
      const share = el('input', { type: 'checkbox', checked: stats.on });
      share.onchange = () => stats.set((stats.on = share.checked));
      app.append(el('label', { className: 'choice' }, share, t('stats.share')), el('small', {}, t('stats.hint')));
    }

    const code = el('textarea', { placeholder: t('settings.importPlaceholder'), spellcheck: false });
    const exportBtn = el('button', { type: 'button', className: 'secondary' }, t('settings.export'));
    exportBtn.onclick = async () => {
      code.value = await h.onExport();
      code.select();
    };
    const importBtn = el('button', { type: 'button', className: 'secondary' }, t('settings.import'));
    // An inline message: validation bubbles don't show reliably on iPhone.
    const importError = el('small', { className: 'import-error', hidden: true }, t('toast.importFailed'));
    code.oninput = () => (importError.hidden = true);
    importBtn.onclick = () => {
      if (h.onImport(code.value)) return dialog.close();
      importError.hidden = false;
    };
    const backup = el(
      'div',
      { className: 'field' },
      el('span', { className: 'field-title' }, t('settings.backup')),
      el('small', {}, t('settings.backupHint')),
      code,
      importError,
      el('div', { className: 'row' }, exportBtn, importBtn),
    );

    // Newest first: the family story, one line per past pet.
    const family = el('div', { className: 'field' }, el('span', { className: 'field-title' }, t('family.title')));
    for (const a of [...h.family].reverse()) {
      const days = Math.max(1, Math.round((a.endedAt - a.hatchedAt) / 86_400_000));
      family.append(
        el(
          'div',
          { className: 'family-row' },
          el('span', { className: `chip ${a.type}` }, t('gen', { n: a.generation })),
          el(
            'span',
            { className: 'family-text' },
            el(
              'span',
              {},
              el('b', {}, a.name),
              ...(a.stars ? [el('span', { className: 'stars', title: t('family.stars', { n: a.stars }) }, '★'.repeat(a.stars))] : []),
              ` · ${speciesName(a.type, a.form)}`,
            ),
            el('small', {}, `${t(`family.${a.ending}`)} · ${t('family.days', { d: days })} · ${t('family.wins', { n: a.wins })}`),
          ),
        ),
      );
    }

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
      help,
      neglect,
      sleep,
      sound,
      app,
      ...(h.family.length ? [family] : []),
      backup,
      el('div', { className: 'row' }, newEgg),
      language,
    );

    if (h.debug) {
      const dbg = h.debug;
      const btn = (label: string, fn: () => void) => {
        const b = el('button', { type: 'button', className: 'secondary' }, label);
        b.onclick = fn;
        return b;
      };
      // Scrub the sky through the day; "Live" hands it back to the game's clock.
      const skyLabel = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`;
      const skyValue = el('span', { className: 'sky-value' }, skyLabel(dbg.getSkyHour()));
      const sky = el('input', { type: 'range', min: '0', max: '23.75', step: '0.25', value: String(dbg.getSkyHour()) });
      sky.oninput = () => {
        dbg.skyHour(Number(sky.value));
        skyValue.textContent = skyLabel(Number(sky.value));
      };
      const live = btn(t('debug.skyLive'), () => {
        dbg.skyHour(null);
        sky.value = String(dbg.getSkyHour());
        skyValue.textContent = skyLabel(dbg.getSkyHour());
      });
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
          el('label', { className: 'choice sky-scrub' }, t('debug.sky'), sky, skyValue),
          el('div', { className: 'row' }, live),
        ),
      );
    }
    body.append(el('small', { className: 'app-version' }, `Pet Hatch ${__APP_VERSION__}`));
    if (h.debug) body.append((clock = el('small', { className: 'app-clock' }, clockLabel(h.now()))));
    dialog.replaceChildren(body);
  };

  // In debug mode, the game clock under the version, ticking while the sheet is open.
  let clock: HTMLElement | undefined;
  if (h.debug) {
    const tick = setInterval(() => clock && (clock.textContent = clockLabel(h.now())), 1000);
    dialog.addEventListener('close', () => clearInterval(tick), { once: true });
  }

  render();
  if (!dialog.open) dialog.showModal();
}
