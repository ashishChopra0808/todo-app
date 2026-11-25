/**
 * The email or phone number a code was sent to, kept for the code screens (verify, reset).
 * It stays in this tab's session storage, never in the page address: addresses end up in
 * browser history, error reports and analytics.
 */
export type AuthTarget = { channel: 'email' | 'phone'; target: string };

const KEY = 'todo.auth-target';
let memory: AuthTarget | null = null; // when storage is blocked

export function rememberAuthTarget(t: AuthTarget) {
  memory = t;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    /* private mode: memory is enough for this visit */
  }
}

export function readAuthTarget(): AuthTarget | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as AuthTarget;
      if ((v.channel === 'email' || v.channel === 'phone') && typeof v.target === 'string')
        return v;
    }
  } catch {
    /* fall through */
  }
  return memory;
}

export function forgetAuthTarget() {
  memory = null;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
