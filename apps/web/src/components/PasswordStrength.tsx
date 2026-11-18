import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Live strength meter. The zxcvbn dictionaries load only when a password field is shown. */
export function PasswordStrength({ password, inputs }: { password: string; inputs: string[] }) {
  const { t } = useTranslation();
  const [result, setResult] = useState<{ password: string; score: number } | null>(null);
  const key = inputs.join('|');
  useEffect(() => {
    if (!password) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      const { checkPassword } = await import('@todo/shared/password');
      const check = await checkPassword(password, key.split('|'));
      if (!cancelled)
        setResult({ password, score: check.problem === 'too_short' ? 0 : check.score });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [password, key]);

  // Only show a score that belongs to what is typed now.
  if (!password || !result || result.password !== password) return null;
  const level = t(`auth.strength.${result.score}`);
  return (
    <div className="stack" aria-live="polite">
      <div className="strength" data-score={result.score} aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <p className="meta">{t('auth.strength.label', { level })}</p>
    </div>
  );
}
