import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { isLocale, localeMeta, matchLocale, resources, type Locale } from '@todo/i18n';

const STORAGE_KEY = 'todo.locale';

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    /* storage unavailable */
  }
  return matchLocale(typeof navigator !== 'undefined' ? navigator.languages : []);
}

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLocale(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React escapes output.
  returnNull: false,
});

export function applyLocale(locale: Locale) {
  if (i18n.language !== locale) void i18n.changeLanguage(locale);
  document.documentElement.lang = locale;
  document.documentElement.dir = localeMeta[locale].dir;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
}

applyLocale(i18n.language as Locale);

export const currentLocale = () => (isLocale(i18n.language) ? i18n.language : 'en');
export const intlLocale = () => localeMeta[currentLocale()].intl;
export default i18n;
