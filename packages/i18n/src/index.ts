import en from './locales/en.json';
import hi from './locales/hi.json';

/**
 * Adding a language: create src/locales/<code>.json with the same keys as en.json,
 * add it to `resources` and `localeMeta`. RTL languages set dir: 'rtl' — the web
 * app uses logical CSS properties so layouts mirror automatically.
 */
export const resources = {
  en: { translation: en },
  hi: { translation: hi },
} as const;

export type Locale = keyof typeof resources;
export const supportedLocales = Object.keys(resources) as Locale[];
export const defaultLocale: Locale = 'en';

export const localeMeta: Record<Locale, { nativeName: string; dir: 'ltr' | 'rtl'; intl: string }> =
  {
    en: { nativeName: 'English', dir: 'ltr', intl: 'en-IN' },
    hi: { nativeName: 'हिन्दी', dir: 'ltr', intl: 'hi-IN' },
  };

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && value in resources;
}

/** Picks the best supported locale from a list like navigator.languages or Accept-Language. */
export function matchLocale(candidates: readonly string[] | undefined | null): Locale {
  for (const c of candidates ?? []) {
    const base = c.toLowerCase().split(/[-_]/)[0];
    if (isLocale(base)) return base;
  }
  return defaultLocale;
}

/** Parses an Accept-Language header into an ordered list of language tags. */
export function parseAcceptLanguage(header: string | undefined): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      return { tag: tag ?? '', q: q ? Number(q.trim().slice(2)) : 1 };
    })
    .filter((x) => x.tag)
    .sort((a, b) => b.q - a.q)
    .map((x) => x.tag);
}

type Json = { [k: string]: string | Json };

/** Server-side translate helper (emails, SMS). The web app uses react-i18next. */
export function translate(locale: Locale, key: string, vars: Record<string, string | number> = {}) {
  const lookup = (l: Locale) =>
    key.split('.').reduce<string | Json | undefined>(
      (node, part) => {
        if (node && typeof node === 'object') return node[part];
        return undefined;
      },
      resources[l].translation as unknown as Json,
    );
  const raw = lookup(locale) ?? lookup(defaultLocale);
  const str = typeof raw === 'string' ? raw : key;
  return str.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => String(vars[name] ?? ''));
}
