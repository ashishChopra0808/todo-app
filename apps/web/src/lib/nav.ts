import { useCanGoBack, useNavigate, useRouter } from '@tanstack/react-router';

/**
 * "Back" that never leaves the app: goes back in the app's own history when there is some
 * (opened from a notification or a shared link there isn't), otherwise to `fallback`.
 */
export function useSafeBack(fallback: '/today' | '/tasks' | '/settings' = '/today') {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const navigate = useNavigate();
  return () => (canGoBack ? router.history.back() : void navigate({ to: fallback }));
}
