import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import de from './de.json';
import en from './en.json';

/**
 * Lightweight, dependency-free i18n layer.
 *
 * Translations live in `en.json` / `de.json` as nested objects; a key is a
 * dot path (e.g. "dashboard.title"). English is the default locale, German the
 * secondary one. `t()` supports `{{param}}` interpolation. The active language
 * is persisted to localStorage so it survives reloads.
 */
export type Language = 'en' | 'de';

const RESOURCES: Record<Language, unknown> = { en, de };
export const LANGUAGES: Language[] = ['en', 'de'];
const STORAGE_KEY = 'clickwrap-admin-lang';
const DEFAULT_LANGUAGE: Language = 'en';

type TranslateParams = Record<string, string | number>;

interface I18nApi {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: string, params?: TranslateParams) => string;
}

const I18nContext = createContext<I18nApi | null>(null);

function resolve(resource: unknown, key: string): string | undefined {
  const value = key.split('.').reduce<unknown>((node, part) => {
    if (node && typeof node === 'object' && part in (node as Record<string, unknown>)) {
      return (node as Record<string, unknown>)[part];
    }
    return undefined;
  }, resource);
  return typeof value === 'string' ? value : undefined;
}

function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

function readInitialLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'de') return stored;
  } catch {
    /* localStorage unavailable — fall back to default */
  }
  return DEFAULT_LANGUAGE;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(readInitialLanguage);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore persistence failures */
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const t = useCallback(
    (key: string, params?: TranslateParams): string => {
      const template =
        resolve(RESOURCES[language], key) ?? resolve(RESOURCES[DEFAULT_LANGUAGE], key) ?? key;
      return interpolate(template, params);
    },
    [language],
  );

  const value = useMemo<I18nApi>(() => ({ language, setLanguage, t }), [language, setLanguage, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation(): I18nApi {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useTranslation must be used within an I18nProvider.');
  return ctx;
}
