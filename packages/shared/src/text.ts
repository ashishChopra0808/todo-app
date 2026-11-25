/**
 * Removes control characters (keeps newline and tab) and the invisible text-direction
 * overrides and isolates (U+202A–202E, U+2066–2069), which can make text read differently from
 * what it is ("Trojan Source"-style spoofing). Plain left/right marks and the joiners Hindi and
 * emoji need stay. Trims. Output is plain text; the UI escapes it.
 */
export function cleanText(input: string): string {
  return (
    input
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g, '')
      .trim()
  );
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
