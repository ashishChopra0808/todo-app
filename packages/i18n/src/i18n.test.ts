import { describe, expect, it } from 'vitest';
import en from './locales/en.json';
import hi from './locales/hi.json';
import { matchLocale, parseAcceptLanguage, translate } from './index';

type Json = { [k: string]: string | Json };
function flatten(obj: Json, prefix = ''): Record<string, string> {
  return Object.entries(obj).reduce<Record<string, string>>((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') acc[key] = v;
    else Object.assign(acc, flatten(v, key));
    return acc;
  }, {});
}
const vars = (s: string) => [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();

describe('translations', () => {
  const enFlat = flatten(en as Json);
  const hiFlat = flatten(hi as Json);

  it('Hindi has every English key and no extras', () => {
    expect(Object.keys(hiFlat).sort()).toEqual(Object.keys(enFlat).sort());
  });

  it('placeholders match between languages', () => {
    for (const [key, value] of Object.entries(enFlat)) {
      expect(vars(hiFlat[key] ?? ''), key).toEqual(vars(value));
    }
  });

  it('no empty strings', () => {
    for (const [key, value] of Object.entries({ ...enFlat, ...hiFlat })) {
      expect(value.trim(), key).not.toBe('');
    }
  });
});

describe('locale helpers', () => {
  it('matches browser languages', () => {
    expect(matchLocale(['hi-IN', 'en'])).toBe('hi');
    expect(matchLocale(['fr-FR'])).toBe('en');
    expect(matchLocale(parseAcceptLanguage('fr;q=0.9, hi-IN;q=0.95'))).toBe('hi');
  });
  it('translates with variables and falls back to the key', () => {
    expect(translate('en', 'email.otp.subject', { code: '123456' })).toContain('123456');
    expect(translate('en', 'missing.key')).toBe('missing.key');
  });
});
