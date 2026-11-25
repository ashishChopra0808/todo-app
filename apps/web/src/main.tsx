import './lib/polyfills';
import '@fontsource-variable/inter';
import '@fontsource/noto-sans-devanagari/devanagari-400.css';
import '@fontsource/noto-sans-devanagari/devanagari-600.css';
import './styles/app.css';
import './lib/i18n';
import {
  MutationCache,
  QueryCache,
  QueryClient,
  onlineManager,
  useIsRestoring,
} from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiError } from './api/client';
import { registerOfflineMutations } from './api/offline';
import { keys } from './api/queries';
import {
  CACHE_BUSTER,
  CACHE_MAX_AGE,
  clearOfflineData,
  idbPersister,
  shouldPersistQuery,
} from './api/persist';
import { ToastProvider } from './components/Toasts';
import { createAppRouter } from './router';

// Error tracking loads only when configured, and after first paint.
if (import.meta.env.VITE_SENTRY_DSN) {
  void import('@sentry/react').then((Sentry) =>
    Sentry.init({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      environment: import.meta.env.VITE_APP_ENV ?? 'development',
      release: import.meta.env.VITE_APP_VERSION,
      beforeBreadcrumb: (b) => (b.category === 'ui.input' ? null : b),
    }),
  );
}

/** Pages anyone can open signed out: a "not signed in" answer there is expected. */
const PUBLIC =
  /^\/(sign-in|sign-up|verify|forgot|reset|join|legal|privacy|terms|suspended|welcome)(\/|$)/;

/**
 * The server says this browser isn't signed in (logged out elsewhere, session expired, account
 * deleted): nothing saved for offline use may outlive that, and app pages go to Log in.
 */
function onError(err: unknown) {
  if (!(err instanceof ApiError) || err.status !== 401) return;
  // Only when we thought someone was signed in; otherwise there's nothing to wipe (and wiping
  // would make signed-out pages ask again, and again).
  if (queryClient.getQueryData(keys.me) === undefined) return;
  // Empty every answer (screens on display ask again, now signed out) and drop changes
  // still waiting from that session.
  queryClient.getMutationCache().clear();
  void queryClient.resetQueries();
  void clearOfflineData();
  const path = window.location.pathname;
  if (!PUBLIC.test(path))
    void router.navigate({ to: '/sign-in', search: { redirect: path + window.location.search } });
}

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      // Kept long enough to be saved for offline use.
      gcTime: CACHE_MAX_AGE,
      retry: (count, err) =>
        !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});
registerOfflineMutations(queryClient);
const router = createAppRouter(queryClient);

// TanStack Query assumes "online" until the browser fires an offline event, so an app opened
// with no connection would try the network and land on the error page. Start from the truth.
if (typeof navigator !== 'undefined' && navigator.onLine === false) onlineManager.setOnline(false);

/** Pages open only once the copy saved on this device is loaded, so they can use it offline. */
function AppRouter() {
  const restoring = useIsRestoring();
  return restoring ? null : <RouterProvider router={router} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: idbPersister,
        maxAge: CACHE_MAX_AGE,
        buster: CACHE_BUSTER,
        dehydrateOptions: {
          shouldDehydrateQuery: shouldPersistQuery,
          // Changes made offline survive closing the app.
          shouldDehydrateMutation: (m) => m.state.isPaused,
        },
      }}
      // Once the saved copy is loaded: confirm the session is still valid (a copy from a
      // session that ended must not linger), send anything still waiting, refresh lists.
      onSuccess={() => {
        void queryClient.invalidateQueries({ queryKey: keys.me });
        void queryClient
          .resumePausedMutations()
          .then(() => queryClient.invalidateQueries({ queryKey: ['tasks'] }));
      }}
    >
      <ToastProvider>
        <AppRouter />
      </ToastProvider>
    </PersistQueryClientProvider>
  </StrictMode>,
);
