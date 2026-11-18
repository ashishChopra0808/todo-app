import { useTranslation } from 'react-i18next';
import { localeMeta, supportedLocales, type Locale } from '@todo/i18n';
import { applyLocale, currentLocale } from '../lib/i18n';

/** Native select: works with every screen reader and keyboard. Shows each language in its own script. */
export function LanguageSelect({
  onChange,
  className = 'lang-select',
  id,
}: {
  onChange?: (l: Locale) => void;
  className?: string;
  id?: string;
}) {
  const { t } = useTranslation();
  const current = currentLocale();
  return (
    <select
      id={id}
      className={className}
      value={current}
      aria-label={id ? undefined : t('language.label')}
      onChange={(e) => {
        const l = e.target.value as Locale;
        applyLocale(l);
        onChange?.(l);
      }}
    >
      {supportedLocales.map((l) => (
        <option key={l} value={l} lang={l}>
          {localeMeta[l].nativeName}
        </option>
      ))}
    </select>
  );
}
