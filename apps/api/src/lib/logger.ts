import type { FastifyServerOptions } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Config } from '../config';

const SENSITIVE_QUERY = /([?&](?:code|state|token|otp|password|callbackURL)=)[^&]*/gi;
/** Secrets that sit in the path: invite codes, and signed file links (local storage). */
const SENSITIVE_PATH = /(\/api\/v1\/(?:invites|files\/local)\/)[^/?#]+/gi;

/** The request address as it may be logged: no codes, tokens or invite codes. */
export function safeUrl(url: string): string {
  return url.replace(SENSITIVE_PATH, '$1[redacted]').replace(SENSITIVE_QUERY, '$1[redacted]');
}

/** Paths redacted from every log line. Bodies are never logged. */
export const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-proxy-secret"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.otp',
  '*.code',
  '*.token',
  '*.email',
  '*.phoneNumber',
];

export function loggerOptions(config: Config): FastifyServerOptions['logger'] {
  return {
    level: config.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    base: { service: 'todo-api', env: config.APP_ENV },
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    formatters: { level: (label) => ({ level: label }) },
    serializers: {
      req(req) {
        return {
          method: req.method,
          url: safeUrl(String(req.url)),
          requestId: req.id,
          userAgent: req.headers['user-agent'],
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  };
}

export function genReqId(req: { headers: Record<string, string | string[] | undefined> }): string {
  const incoming = req.headers['x-request-id'];
  if (typeof incoming === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(incoming)) return incoming;
  return randomUUID();
}
