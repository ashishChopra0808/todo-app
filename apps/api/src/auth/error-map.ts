import { ERROR_CODES, type ErrorCode } from '@todo/shared';

/** Maps Better Auth error codes to our stable API codes so the client sees one error format. */
const MAP: Record<string, ErrorCode> = {
  INVALID_EMAIL_OR_PASSWORD: 'invalid_credentials',
  INVALID_PHONE_NUMBER_OR_PASSWORD: 'invalid_credentials',
  INVALID_PASSWORD: 'invalid_credentials',
  INVALID_EMAIL: 'validation_failed',
  INVALID_PHONE_NUMBER: 'validation_failed',
  EMAIL_NOT_VERIFIED: 'not_verified',
  PHONE_NUMBER_NOT_VERIFIED: 'not_verified',
  USER_ALREADY_EXISTS: 'email_taken',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'email_taken',
  PHONE_NUMBER_EXIST: 'phone_taken',
  INVALID_OTP: 'invalid_otp',
  OTP_EXPIRED: 'otp_expired',
  TOO_MANY_ATTEMPTS: 'too_many_attempts',
  PASSWORD_TOO_SHORT: 'weak_password',
  PASSWORD_TOO_LONG: 'validation_failed',
  FAILED_TO_CREATE_SESSION: 'forbidden',
  SESSION_EXPIRED: 'reauth_required',
  UNAUTHORIZED: 'unauthenticated',
};

export function mapAuthError(code: string | undefined, status: number): ErrorCode {
  if (code) {
    if (MAP[code]) return MAP[code];
    const lower = code.toLowerCase();
    if ((ERROR_CODES as readonly string[]).includes(lower)) return lower as ErrorCode;
  }
  if (status === 429) return 'rate_limited';
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status >= 500) return 'internal';
  return 'validation_failed';
}
