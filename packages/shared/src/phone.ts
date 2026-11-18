import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

/** Returns the number in E.164 (+919876543210) or null if it is not a valid number. */
export function normalizePhone(input: string, defaultCountry: CountryCode = 'IN'): string | null {
  const parsed = parsePhoneNumberFromString(input.trim(), defaultCountry);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

export function isIndianNumber(e164: string): boolean {
  return e164.startsWith('+91');
}

/** Placeholder email for phone-only accounts (Better Auth requires an email). Never shown or emailed. */
export const PLACEHOLDER_EMAIL_DOMAIN = 'phone.todo.invalid';
export function placeholderEmailFor(e164: string): string {
  return `${e164.replace('+', '')}@${PLACEHOLDER_EMAIL_DOMAIN}`;
}
export function isPlaceholderEmail(email: string | null | undefined): boolean {
  return !!email && email.endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);
}
