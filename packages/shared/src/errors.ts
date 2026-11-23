/**
 * Stable error codes returned by the API as { error: { code, message, fields? }, requestId }.
 * The web app maps each code to a translated message: errors.<code> in the i18n files.
 */
export const ERROR_CODES = [
  'validation_failed',
  'unauthenticated',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'account_locked',
  'account_suspended',
  'not_verified',
  'invalid_credentials',
  'already_exists',
  'phone_taken',
  'email_taken',
  'weak_password',
  'invalid_otp',
  'otp_expired',
  'too_many_attempts',
  'unsupported_file',
  'file_too_large',
  'reauth_required',
  'invite_invalid',
  'group_full',
  'too_many_groups',
  'last_admin',
  'daily_limit',
  'not_a_member',
  'sms_unavailable',
  'internal',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; fields?: Record<string, string> };
  requestId?: string;
}
