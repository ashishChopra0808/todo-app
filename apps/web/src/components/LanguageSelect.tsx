import { useTranslation } from 'react-i18next';
import { localeMeta, supportedLocales, type Locale } from '@todo/i18n';
import { applyLocale, currentLocale } from '../lib/i18n';
import { Select } from './Select';

/** Language picker. Shows each language in its own script. */
export function LanguageSelect({
  onChange,
  variant = 'pill',
}: {
  onChange?: (l: Locale) => void;
  /** `pill`: compact picker with a screen-reader-only label. `field`: settings form with a visible label. */
  variant?: 'pill' | 'field';
}) {
  const { t } = useTranslation();
  return (
    <Select<Locale>
      label={variant === 'field' ? t('settings.preferences.language') : t('language.label')}
      hideLabel={variant === 'pill'}
      variant={variant}
      value={currentLocale()}
      onChange={(l) => {
        applyLocale(l);
        onChange?.(l);
      }}
      options={supportedLocales.map((l) => ({
        value: l,
        label: localeMeta[l].nativeName,
        lang: l,
      }))}
    />
  );
}
