import type { ErrorCode } from '@todo/shared';

const STATUS: Partial<Record<ErrorCode, number>> = {
  validation_failed: 400,
  weak_password: 400,
  invalid_otp: 400,
  otp_expired: 400,
  unsupported_file: 415,
  file_too_large: 413,
  unauthenticated: 401,
  invalid_credentials: 401,
  reauth_required: 401,
  forbidden: 403,
  not_verified: 403,
  account_suspended: 403,
  not_found: 404,
  conflict: 409,
  already_exists: 409,
  email_taken: 409,
  phone_taken: 409,
  account_locked: 423,
  rate_limited: 429,
  daily_limit: 429,
  invite_invalid: 410,
  group_full: 409,
  too_many_groups: 409,
  last_admin: 409,
  not_a_member: 400,
  sms_unavailable: 503,
  too_many_attempts: 429,
  internal: 500,
};

/** Errors thrown by route handlers; the error handler turns them into { error: { code, message } }. */
export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message?: string,
    readonly extra: {
      fields?: Record<string, string>;
      retryAfterSeconds?: number;
      details?: unknown;
    } = {},
  ) {
    super(message ?? code);
    this.status = STATUS[code] ?? 400;
  }
}

export const notFound = () => new AppError('not_found', 'Not found');
export const forbidden = () => new AppError('forbidden', 'You do not have access to this');
