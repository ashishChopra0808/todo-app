import { useTranslation } from 'react-i18next';

export function Avatar({
  name,
  url,
  large,
}: {
  name: string;
  url: string | null;
  large?: boolean;
}) {
  const { t } = useTranslation();
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  return (
    <span className={`avatar${large ? ' avatar--lg' : ''}`}>
      {url ? (
        <img src={url} alt={t('a11y.avatarOf', { name })} referrerPolicy="no-referrer" />
      ) : (
        <span aria-hidden="true">{initial}</span>
      )}
    </span>
  );
}
