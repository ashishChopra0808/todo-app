const PENDING_KEY = 'todo.pendingJoin';

/** Remembers an invite while someone signs up (through email/phone codes or Google) and comes back. */
export function rememberPendingJoin(code: string) {
  try {
    sessionStorage.setItem(PENDING_KEY, code);
  } catch {
    /* storage unavailable: the redirect link still works for log in */
  }
}

export function takePendingJoin(): string | null {
  try {
    const code = sessionStorage.getItem(PENDING_KEY);
    if (code) sessionStorage.removeItem(PENDING_KEY);
    return code;
  } catch {
    return null;
  }
}
