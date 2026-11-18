import type { TFunction } from 'i18next';
import { ApiError } from '../api/client';

/** Friendly, translated message for any error. */
export function errorMessage(err: unknown, t: TFunction): string {
  if (err instanceof ApiError) {
    const base = t(`errors.${err.code}`, { defaultValue: t('errors.internal') });
    if (err.code === 'rate_limited' && err.retryAfterSeconds)
      return `${base} ${t('errors.retryAfter', { seconds: err.retryAfterSeconds })}`;
    return base;
  }
  return t('errors.internal');
}

/** Translated per-field messages from a validation error. */
export function fieldErrors(err: unknown, t: TFunction): Record<string, string> {
  if (!(err instanceof ApiError)) return {};
  const out: Record<string, string> = {};
  for (const [field, code] of Object.entries(err.fields)) {
    out[field] = t(`errors.field.${code}`, { defaultValue: t('errors.field.invalid') });
  }
  return out;
}
