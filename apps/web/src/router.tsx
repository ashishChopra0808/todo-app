import type { QueryClient } from '@tanstack/react-query';
import {
  Outlet,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from '@tanstack/react-router';
import { ApiError } from './api/client';
import { meQuery } from './api/queries';
import { AppShell } from './components/AppShell';
import { UpdatePrompt } from './components/UpdatePrompt';
import { ErrorPage, NotFoundPage } from './routes/misc';
import type { TasksSearch } from './routes/tasks';

// Each screen is its own chunk, loaded on first visit (and preloaded on hover/touch of a link).
const auth = () => import('./routes/auth');
const SignInPage = lazyRouteComponent(auth, 'SignInPage');
const SignUpPage = lazyRouteComponent(auth, 'SignUpPage');
const VerifyPage = lazyRouteComponent(auth, 'VerifyPage');
const ForgotPage = lazyRouteComponent(auth, 'ForgotPage');
const ResetPage = lazyRouteComponent(auth, 'ResetPage');
const SuspendedPage = lazyRouteComponent(auth, 'SuspendedPage');
const LegalPage = lazyRouteComponent(() => import('./routes/misc'), 'LegalPage');
const WelcomePage = lazyRouteComponent(() => import('./routes/misc'), 'WelcomePage');
const TodayPage = lazyRouteComponent(() => import('./routes/today'), 'TodayPage');
const TasksPage = lazyRouteComponent(() => import('./routes/tasks'), 'TasksPage');
const NewTaskPage = lazyRouteComponent(() => import('./routes/task-form'), 'NewTaskPage');
const EditTaskPage = lazyRouteComponent(() => import('./routes/task-form'), 'EditTaskPage');
const TaskDetailPage = lazyRouteComponent(() => import('./routes/task-detail'), 'TaskDetailPage');
const SettingsPage = lazyRouteComponent(() => import('./routes/settings'), 'SettingsPage');

interface Ctx {
  queryClient: QueryClient;
}

const str = (v: unknown) => (typeof v === 'string' && v.length <= 300 ? v : undefined);
const channel = (v: unknown) => (v === 'phone' ? 'phone' : 'email') as 'email' | 'phone';

const rootRoute = createRootRouteWithContext<Ctx>()({
  component: () => (
    <>
      <Outlet />
      <UpdatePrompt />
    </>
  ),
  notFoundComponent: NotFoundPage,
  errorComponent: ({ reset }) => <ErrorPage reset={reset} />,
});

/** Public pages that bounce signed-in users to Today. */
const guestRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'guest',
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.fetchQuery(meQuery).catch(() => null);
    if (me) throw redirect({ to: '/today' });
  },
});

/** Everything that needs a verified, non-suspended user. The API enforces this too. */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  component: AppShell,
  beforeLoad: async ({ context, location }) => {
    try {
      await context.queryClient.ensureQueryData(meQuery);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'account_suspended')
        throw redirect({ to: '/suspended' });
      if (err instanceof ApiError && (err.status === 401 || err.code === 'not_verified')) {
        throw redirect({ to: '/sign-in', search: { redirect: location.href } });
      }
      throw err;
    }
  },
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/today' });
  },
});

const signIn = createRoute({
  getParentRoute: () => guestRoute,
  path: '/sign-in',
  validateSearch: (
    s: Record<string, unknown>,
  ): { redirect?: string; reset?: string; error?: string; deleted?: string } => ({
    redirect: str(s.redirect),
    reset: str(s.reset),
    error: str(s.error),
    deleted: str(s.deleted),
  }),
  component: SignInPage,
});
const signUp = createRoute({
  getParentRoute: () => guestRoute,
  path: '/sign-up',
  component: SignUpPage,
});
const verify = createRoute({
  getParentRoute: () => guestRoute,
  path: '/verify',
  validateSearch: (
    s: Record<string, unknown>,
  ): { channel: 'email' | 'phone'; target: string; purpose?: string } => ({
    channel: channel(s.channel),
    target: str(s.target) ?? '',
    purpose: str(s.purpose),
  }),
  component: VerifyPage,
});
const forgot = createRoute({
  getParentRoute: () => guestRoute,
  path: '/forgot',
  component: ForgotPage,
});
const reset = createRoute({
  getParentRoute: () => guestRoute,
  path: '/reset',
  validateSearch: (s: Record<string, unknown>) => ({
    channel: channel(s.channel),
    target: str(s.target) ?? '',
  }),
  component: ResetPage,
});
const suspended = createRoute({
  getParentRoute: () => rootRoute,
  path: '/suspended',
  component: SuspendedPage,
});
const legal = createRoute({
  getParentRoute: () => rootRoute,
  path: '/legal/$page',
  component: LegalPage,
});

const today = createRoute({
  getParentRoute: () => appRoute,
  path: '/today',
  validateSearch: (s: Record<string, unknown>): { task?: string } => ({ task: str(s.task) }),
  component: TodayPage,
});
const tasks = createRoute({
  getParentRoute: () => appRoute,
  path: '/tasks',
  validateSearch: (s: Record<string, unknown>): TasksSearch => ({
    tab: s.tab === 'overdue' || s.tab === 'completed' ? s.tab : undefined,
    q: str(s.q),
    status: str(s.status),
    priority: str(s.priority),
    dueFrom: str(s.dueFrom),
    dueTo: str(s.dueTo),
    focus: str(s.focus),
    task: str(s.task),
  }),
  component: TasksPage,
});
const newTask = createRoute({
  getParentRoute: () => appRoute,
  path: '/tasks/new',
  component: NewTaskPage,
});
const taskDetail = createRoute({
  getParentRoute: () => appRoute,
  path: '/tasks/$id',
  component: TaskDetailPage,
});
const editTask = createRoute({
  getParentRoute: () => appRoute,
  path: '/tasks/$id/edit',
  component: EditTaskPage,
});
const settings = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  component: SettingsPage,
});
const welcome = createRoute({
  getParentRoute: () => appRoute,
  path: '/welcome',
  component: WelcomePage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  guestRoute.addChildren([signIn, signUp, verify, forgot, reset]),
  appRoute.addChildren([today, tasks, newTask, taskDetail, editTask, settings, welcome]),
  suspended,
  legal,
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    scrollRestoration: true,
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
