import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { OTP } from '@todo/shared';
import { Field } from './Field';

/**
 * One input for the 6-digit code: works with SMS/email autofill (autocomplete="one-time-code"),
 * paste and screen readers better than six separate boxes.
 */
export function OtpField({
  value,
  onChange,
  error,
  onComplete,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string;
  onComplete?: (v: string) => void;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Field label={t('auth.otp.label')} error={error} hint={t('auth.otp.rules')}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          className="input input--otp"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={OTP.length}
          autoFocus={autoFocus}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          value={value}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '').slice(0, OTP.length);
            onChange(v);
            if (v.length === OTP.length) onComplete?.(v);
          }}
        />
      )}
    </Field>
  );
}

/** Counts down from `seconds`; `restart()` starts again. */
export function useCountdown(seconds: number) {
  const [endsAt, setEndsAt] = useState(() => Date.now() + seconds * 1000);
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    const h = setInterval(
      () => setLeft(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))),
      1000,
    );
    return () => clearInterval(h);
  }, [endsAt]);
  return {
    left,
    restart: (s = seconds) => {
      setEndsAt(Date.now() + s * 1000);
      setLeft(s);
    },
  };
}

export function mmss(total: number) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
