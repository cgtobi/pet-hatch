import { canVibrate } from '../feedback';
import { LANGUAGE_NAMES, LANGUAGES, t } from '../i18n';
import { BATTLE_ENERGY } from '../sim/battle';
import { STAT_CAPS, TRAIN_ENERGY } from '../sim/training';
import { ALL_SPECIES, BOOK_FORMS, BOOK_TYPES } from '../sim/book';
import { speciesName } from '../sim/evolution';
import { DEFAULT_SCHOOL, SCHOOL_MAX_H } from '../sim/clock';
import type { Ancestor, SchoolTime, Settings } from '../sim/types';
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
  /** The species book: what was discovered and raised (keys like 'tide.adult.speed'), what's new since last opened. */
  book: { discovered: Set<string>; raised: Set<string>; fresh: Set<string>; markShown(): void };
  onChange(patch: Partial<Settings>): void;
  /** Returns the save code, already copied to the clipboard if possible. */
  onExport(): Promise<string>;
  onImport(code: string): boolean;
  onNewEgg(): void;
  onInstall(): void;
  /** Anonymous pet stats, where the server collects them (null otherwise: nothing to switch). */
  stats: null | { on: boolean; set(on: boolean): void };
  /**
   * Alerts while the game is closed, where the server sends them (null otherwise). 'install': not until the game
   * is on the Home Screen (iPhone, iPad). set() resolves to whether they are on now.
   */
  alerts: null | { on: boolean; ready: 'yes' | 'install'; set(on: boolean): Promise<boolean> };
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

/** Bedtime and school time, shared by the settings sheet and the welcome before the first egg. */
export function timeFields(
  settings: Settings,
  onChange: (patch: Partial<Settings>) => void,
): { sleep: HTMLElement; school: HTMLElement } {
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
      hourSelect(settings.sleepStart, (v) => onChange({ sleepStart: (settings.sleepStart = v) }), t('settings.sleepFrom')),
      hourSelect(settings.sleepEnd, (v) => onChange({ sleepEnd: (settings.sleepEnd = v) }), t('settings.sleepTo')),
    ),
    el('small', {}, t('settings.sleepHint')),
  );

  // Day care during school: no calls, alerts or care mistakes while the player is in class. Not in Classic, where
  // the pet needs the player every day.
  const school: SchoolTime = { ...DEFAULT_SCHOOL, ...settings.school, days: [...(settings.school?.days ?? DEFAULT_SCHOOL.days)] };
  const classic = settings.neglect === 'classic';
  const saveSchool = () => onChange({ school: (settings.school = { ...school, days: [...school.days] }) });
  const schoolOn = el('input', { type: 'checkbox', checked: school.on, disabled: classic });
  const days = el('div', { className: 'days' });
  const dayName = new Intl.DateTimeFormat(document.documentElement.lang || undefined, { weekday: 'short' });
  for (const d of [1, 2, 3, 4, 5, 6, 0]) {
    const b = el('button', { type: 'button', className: school.days.includes(d) ? 'on' : '', disabled: classic });
    // 4 January 2026 was a Sunday.
    b.textContent = dayName.format(new Date(2026, 0, 4 + d));
    b.ariaPressed = String(school.days.includes(d));
    b.onclick = () => {
      school.days = school.days.includes(d) ? school.days.filter((x) => x !== d) : [...school.days, d].sort();
      b.classList.toggle('on', school.days.includes(d));
      b.ariaPressed = String(school.days.includes(d));
      saveSchool();
    };
    days.append(b);
  }
  // From the start of one hour to the start of a later one, at most SCHOOL_MAX_H hours apart.
  const hours = (value: number, lo: number, hi: number, label: string) => {
    const sel = el('select', { ariaLabel: label, disabled: classic });
    for (let i = lo; i <= hi; i++) sel.append(el('option', { value: String(i), selected: i === value }, hourLabel(i)));
    return sel;
  };
  const from = hours(school.from, 0, 22, t('settings.sleepFrom'));
  const to = hours(school.to, 1, 23, t('settings.sleepTo'));
  from.onchange = () => {
    school.from = Number(from.value);
    school.to = Math.min(23, Math.max(school.from + 1, Math.min(school.to, school.from + SCHOOL_MAX_H)));
    to.value = String(school.to);
    saveSchool();
  };
  to.onchange = () => {
    school.to = Number(to.value);
    school.from = Math.max(0, Math.min(school.to - 1, Math.max(school.from, school.to - SCHOOL_MAX_H)));
    from.value = String(school.from);
    saveSchool();
  };
  const schoolTimes = el(
    'div',
    { className: 'field', hidden: !school.on || classic },
    days,
    el(
      'div',
      { className: 'row' },
      el('label', { className: 'choice' }, t('settings.sleepFrom'), from),
      el('label', { className: 'choice' }, t('settings.sleepTo'), to),
    ),
  );
  schoolOn.onchange = () => {
    school.on = schoolOn.checked;
    schoolTimes.hidden = !school.on;
    saveSchool();
  };
  const schoolField = el(
    'div',
    { className: 'field' },
    el('span', { className: 'field-title' }, t('settings.school')),
    el('label', { className: 'choice' }, schoolOn, t('settings.schoolToggle')),
    schoolTimes,
    el('small', {}, t(classic ? 'settings.schoolClassic' : 'settings.schoolHint')),
  );
  return { sleep, school: schoolField };
}

/** A page of the sheet: the settings, the family story, or the species book. */
export type SheetPage = 'settings' | 'family' | 'book';

/** Builds the sheet from scratch each time it opens (cheap, and picks up language changes). */
export function openSettings(
  dialog: HTMLDialogElement,
  settings: Settings,
  install: InstallState,
  h: SettingsHandlers,
  page: SheetPage = 'settings',
): void {
  const closeButton = () => {
    const close = el('button', { type: 'button', className: 'round', ariaLabel: t('settings.done') });
    close.innerHTML = icon('close', 20);
    close.onclick = () => dialog.close();
    return close;
  };

  const render = () => {
    const close = closeButton();

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

    const { sleep, school: schoolField } = timeFields(settings, (patch) => h.onChange(patch));

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
    if (h.alerts?.ready === 'install') app.append(el('small', {}, t('alerts.install')));
    else if (h.alerts) {
      const alerts = h.alerts;
      const box = el('input', { type: 'checkbox', checked: alerts.on });
      const blocked = el('small', { className: 'import-error', hidden: true }, t('alerts.blocked'));
      box.onchange = async () => {
        box.disabled = true;
        const want = box.checked;
        const on = await alerts.set(want);
        box.checked = alerts.on = on;
        blocked.hidden = on || !want;
        box.disabled = false;
      };
      app.append(el('label', { className: 'choice' }, box, t('alerts.toggle')), el('small', {}, t('alerts.hint')), blocked);
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
      schoolField,
      sound,
      app,
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

  /** The family story, newest first: one line per past pet. Shown even before there is one, so players know it exists. */
  const showFamily = () => {
    const family = el('div', { className: 'field' });
    if (!h.family.length) family.append(el('small', {}, t('family.empty')));
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
            el(
              'small',
              {},
              `${t(`family.${a.ending}`)} · ${t('family.days', { d: days })} · ${t('family.wins', { n: a.wins })}` +
                (a.saved ? ` · ${t('family.saved')}` : ''),
            ),
          ),
        ),
      );
    }
    dialog.replaceChildren(
      el(
        'div',
        { className: 'settings-body' },
        el('div', { className: 'settings-head' }, el('h2', { id: 'settings-title' }, t('family.title')), closeButton()),
        family,
      ),
    );
  };

  /** The species book: each element's nine species, raised, seen in battle, or still a silhouette. */
  const showBook = () => {
    const body = el(
      'div',
      { className: 'settings-body' },
      el('div', { className: 'settings-head' }, el('h2', { id: 'settings-title' }, t('book.title')), closeButton()),
      el(
        'small',
        { className: 'book-summary' },
        t('book.summary', { n: h.book.discovered.size, of: ALL_SPECIES.length, raised: h.book.raised.size }),
      ),
    );
    for (const type of BOOK_TYPES) {
      const grid = el('div', { className: 'book-grid' });
      for (const form of BOOK_FORMS) {
        const key = `${type}.${form}`;
        const known = h.book.discovered.has(key);
        const state = h.book.raised.has(key) ? 'raised' : known ? 'seen' : 'unknown';
        grid.append(
          el(
            'div',
            { className: `book-cell ${state}` },
            el('img', { src: `species/${type}-${form}.png`, alt: known ? speciesName(type, form) : '', loading: 'lazy' }),
            el('b', {}, known ? speciesName(type, form) : '???'),
            el('small', {}, state === 'unknown' ? '\u00a0' : t(state === 'raised' ? 'book.raised' : 'book.seen')),
            ...(h.book.fresh.has(key) ? [el('span', { className: 'book-new' }, t('book.newTag'))] : []),
          ),
        );
      }
      body.append(el('div', { className: 'field' }, el('span', { className: `chip ${type} book-type` }, t(`type.${type}`)), grid));
    }
    dialog.replaceChildren(body);
    // Opening the book is seeing what's new: the next time, these have no "new" mark.
    h.book.markShown();
    h.book.fresh.clear();
  };

  // In debug mode, the game clock under the version, ticking while the sheet is open.
  let clock: HTMLElement | undefined;
  if (h.debug) {
    const tick = setInterval(() => clock && (clock.textContent = clockLabel(h.now())), 1000);
    dialog.addEventListener('close', () => clearInterval(tick), { once: true });
  }

  if (page === 'book') showBook();
  else if (page === 'family') showFamily();
  else render();
  if (!dialog.open) dialog.showModal();
}
