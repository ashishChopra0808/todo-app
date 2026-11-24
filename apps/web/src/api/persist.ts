import { del as idbDel, get as idbGet, set as idbSet } from 'idb-keyval';
import type { PersistedClient, Persister } from '@tanstack/query-persist-client-core';
import type { Query } from '@tanstack/react-query';

const KEY = 'todo.query-cache.v1';

/**
 * Keeps recently viewed tasks, lists, groups and the profile in IndexedDB, plus changes made
 * offline that haven't been sent yet. Cleared on log out (see clearOfflineData).
 */
export const idbPersister: Persister = {
  persistClient: (client: PersistedClient) => idbSet(KEY, client).catch(() => undefined),
  restoreClient: () => idbGet<PersistedClient>(KEY).catch(() => undefined),
  removeClient: () => idbDel(KEY).catch(() => undefined),
};

/** Only data worth having offline. Never invites, admin data or anything mid-flight. */
const KEEP = new Set(['me', 'tasks', 'groups', 'counts']);
export function shouldPersistQuery(q: Query): boolean {
  const head = q.queryKey[0];
  return q.state.status === 'success' && typeof head === 'string' && KEEP.has(head);
}

/** Log out / account switch: nothing of the last person may stay on the device. */
export async function clearOfflineData() {
  await idbDel(KEY).catch(() => undefined);
}

/** Bumped when cached shapes change, so an old cache is thrown away instead of misread. */
export const CACHE_BUSTER = 'p3-1';
export const CACHE_MAX_AGE = 7 * 24 * 3600 * 1000;
