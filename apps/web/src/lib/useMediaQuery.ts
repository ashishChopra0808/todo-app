import { useSyncExternalStore } from 'react';

/** True while the media query matches; updates on resize/rotation. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Width from which tasks open in a side panel next to the list (the desktop design). */
export const WIDE_QUERY = '(min-width: 1200px)';
