/** Removes control characters (keeps newline and tab) and trims. Output is plain text; the UI escapes it. */
export function cleanText(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
}

/** Collapses whitespace for single-line fields such as titles and names. */
export function cleanLine(input: string): string {
  return cleanText(input).replace(/\s+/g, ' ');
}

export function maskEmail(email: string | null | undefined): string {
  if (!email) return '';
  const [user = '', domain = ''] = email.split('@');
  const keep = user.slice(0, 1);
  return `${keep}${'*'.repeat(Math.max(user.length - 1, 1))}@${domain}`;
}

export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const digits = phone.replace(/\s/g, '');
  if (digits.length <= 4) return '****';
  return `${digits.slice(0, 3)}${'*'.repeat(digits.length - 5)}${digits.slice(-2)}`;
}
