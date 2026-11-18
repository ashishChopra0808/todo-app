import * as Sentry from '@sentry/node';
import type { Config } from '../config';

const PII_KEYS = /pass(word)?|otp|code|token|secret|cookie|authorization|email|phone/i;

function scrub(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(scrub);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [
      k,
      PII_KEYS.test(k) ? '[redacted]' : scrub(v),
    ]),
  );
}

export function initSentry(config: Config) {
  if (!config.SENTRY_DSN) return;
  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.APP_ENV,
    tracesSampleRate: 0.1,
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies;
        delete event.request.data;
        event.request.headers = scrub(event.request.headers) as Record<string, string>;
        if (event.request.query_string) event.request.query_string = '[redacted]';
      }
      if (event.extra) event.extra = scrub(event.extra) as Record<string, unknown>;
      return event;
    },
  });
}
