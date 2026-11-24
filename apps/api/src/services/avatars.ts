import type { Storage } from './storage';

/** Columns needed to show someone's photo: an uploaded avatar's storage key, or their Google picture. */
export interface AvatarSource {
  avatarKey: string | null;
  image: string | null;
}

export function createAvatars(storage: Storage) {
  return async function avatarUrl(src: AvatarSource | null | undefined): Promise<string | null> {
    if (!src) return null;
    if (src.avatarKey) return storage.signedUrl(src.avatarKey);
    return src.image ?? null;
  };
}
export type AvatarUrl = ReturnType<typeof createAvatars>;
