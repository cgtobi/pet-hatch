import type { Language } from '../sim/types';
import { de } from './de';
import { en } from './en';
import { es } from './es';
import { fr } from './fr';
import { it } from './it';
import { nl } from './nl';

export type Lang = Language;
export type LangSetting = Lang | 'auto';
export type TextKey = keyof typeof en;
/** A full translation: one string per English key. */
export type Dict = Record<TextKey, string>;

/** Languages in the order the language picker lists them. */
export const LANGUAGES: Lang[] = ['en', 'de', 'fr', 'es', 'it', 'nl'];
/** Each language's own name, shown in the picker in every UI language. */
export const LANGUAGE_NAMES: Record<Lang, string> = {
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  it: 'Italiano',
  nl: 'Nederlands',
};

const dictionaries: Record<Lang, Dict> = { en, de, fr, es, it, nl };
let current: Lang = 'en';

export function resolveLang(setting: LangSetting): Lang {
  if (setting !== 'auto') return setting;
  const preferred = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0];
    if (base in dictionaries) return base as Lang;
  }
  return 'en';
}

export function setLang(setting: LangSetting): Lang {
  current = resolveLang(setting);
  document.documentElement.lang = current;
  return current;
}

/** "A, B and C" in the current language. */
export function listOf(items: string[]): string {
  return new Intl.ListFormat(current, { type: 'conjunction' }).format(items);
}

export function t(key: TextKey, params: Record<string, string | number> = {}): string {
  const text = dictionaries[current][key] ?? en[key];
  return text.replace(/\{(\w+)\}/g, (_, p: string) => String(params[p] ?? `{${p}}`));
}
