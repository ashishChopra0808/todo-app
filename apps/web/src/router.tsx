import { onlineManager, type QueryClient } from '@tanstack/react-query';
import {
  Outlet,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  useRouterState,
  lazyRouteComponent,
  redirect,
} from '@tanstack/react-router';
import { ApiError } from './api/client';
import {
  TODAY_PARAMS,
  countsOptions,
  groupsOptions,
  meQuery,
  taskListOptions,
  taskPagesOptions,
} from './api/queries';
import { AppShell } from './components/AppShell';
import { UpdatePrompt } from './components/UpdatePrompt';
import { ErrorPage, NotFoundPage } from './routes/misc';
import type { GroupSearch } from './routes/groups';
import type { TasksSearch } from './routes/tasks-params';
import { tasksParams } from './routes/tasks-params';

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
const GroupsPage = lazyRouteComponent(() => import('./routes/groups'), 'GroupsPage');
const GroupPage = lazyRouteComponent(() => import('./routes/groups'), 'GroupPage');
const GroupSettingsPage = lazyRouteComponent(
  () => import('./routes/group-settings'),
  'GroupSettingsPage',
);
const JoinPage = lazyRouteComponent(() => import('./routes/join'), 'JoinPage');
const AdminPage = lazyRouteComponent(() => import('./routes/admin'), 'AdminPage');
const VoiceTaskPage = lazyRouteComponent(() => import('./routes/task-form'), 'VoiceTaskPage');
const InboxPage = lazyRouteComponent(() => import('./routes/inbox'), 'InboxPage');
const SimpleHomePage = lazyRouteComponent(() => import('./routes/simple'), 'SimpleHomePage');
const SimplePersonPage = lazyRouteComponent(() => import('./routes/simple'), 'SimplePersonPage');
const SimpleTaskPage = lazyRouteComponent(() => import('./routes/simple'), 'SimpleTaskPage');

interface Ctx {
  queryClient: QueryClient;
}

const str = (v: unknown) => (typeof v === 'string' && v.length <= 300 ? v : undefined);
const channel = (v: unknown) => (v === 'phone' ? 'phone' : 'email') as 'email' | 'phone';

/** Shows a bar while the next page waits on the server (e.g. a slow sign-in check). */
function RouteProgress() {
  const loading = useRouterState({ select: (s) => s.status === 'pending' });
  return loading ? <div className="route-progress" aria-hidden="true" /> : null;
}

const rootRoute = createRootRouteWithContext<Ctx>()({
  component: () => (
    <>
      <RouteProgress />
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
    // Offline the server can't be asked (the question would wait for the connection): go by
    // the profile saved on this device.
    if (!onlineManager.isOnline()) {
      if (context.queryClient.getQueryData(meQuery.queryKey)) throw redirect({ to: '/today' });
      return;
    }
    // Ask the server, not the copy saved for offline use: it may be from a session that ended.
    const me = await context.queryClient.fetchQuery({ ...meQuery, staleTime: 0 }).catch(() => null);
    if (me) throw redirect({ to: '/today' });
  },
});

/** Everything that needs a verified, non-suspended user. The API enforces this too. */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  component: AppShell,
  // A loader (not beforeLoad) so the profile check runs in parallel with the screens' own
  // data loaders — the task list doesn't wait for it. The API enforces sign-in on every call anyway.
  loader: async ({ context, location }) => {
    const saved = context.queryClient.getQueryData(meQuery.queryKey);
    // Offline: the profile saved on this device is enough to open the app (the server checks
    // again once the connection is back). Never signed in here → Log in.
    if (!onlineManager.isOnline()) {
      if (saved) return;
      throw redirect({ to: '/sign-in', search: { redirect: location.href } });
    }
    try {
      await context.queryClient.ensureQueryData(meQuery);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'account_suspended')
        throw redirect({ to: '/suspended' });
      if (err instanceof ApiError && (err.status === 401 || err.code === 'not_verified')) {
        throw redirect({ to: '/sign-in', search: { redirect: location.href } });
      }
      // The connection dropped (or the server is unreachable): carry on with the saved copy.
      if (err instanceof ApiError && err.code === 'network' && saved) return;
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
  ): { channel: 'email' | 'phone'; target?: string; purpose?: string } => ({
    channel: channel(s.channel),
    // Old links only: the address is moved to session storage and dropped from the URL.
    target: str(s.target),
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
  validateSearch: (
    s: Record<string, unknown>,
  ): { channel: 'email' | 'phone'; target?: string } => ({
    channel: channel(s.channel),
    target: str(s.target),
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
  // Start fetching while the screen's code downloads (not awaited, so navigation is instant).
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(taskListOptions(TODAY_PARAMS));
    void context.queryClient.prefetchQuery(countsOptions);
    void context.queryClient.prefetchQuery(groupsOptions);
  },
  component: TodayPage,
});
const tasks = createRoute({
  getParentRoute: () => appRoute,
  path: '/tasks',
  validateSearch: (s: Record<string, unknown>): TasksSearch => ({
    tab:
      s.tab === 'overdue' || s.tab === 'completed' || s.tab === 'assigned_by_me'
        ? s.tab
        : undefined,
    group: str(s.group),
    assignee: str(s.assignee),
    q: str(s.q),
    status: str(s.status),
    priority: str(s.priority),
    dueFrom: str(s.dueFrom),
    dueTo: str(s.dueTo),
    focus: str(s.focus),
    task: str(s.task),
  }),
  loaderDeps: ({ search }) => ({ search }),
  loader: ({ context, deps }) => {
    const p = tasksParams(deps.search);
    void context.queryClient.prefetchInfiniteQuery(
      taskPagesOptions({ ...p, status: [...p.status], priority: [...p.priority] }),
    );
    void context.queryClient.prefetchQuery(countsOptions);
  },
  component: TasksPage,
});
const newTask = createRoute({
  getParentRoute: () => appRoute,
  path: '/tasks/new',
  validateSearch: (s: Record<string, unknown>): { group?: string } => ({ group: str(s.group) }),
  loader: ({ context }) => void context.queryClient.prefetchQuery(groupsOptions),
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
const voiceTask = createRoute({
  getParentRoute: () => appRoute,
  path: '/tasks/voice',
  validateSearch: (s: Record<string, unknown>): { group?: string } => ({ group: str(s.group) }),
  component: VoiceTaskPage,
});
const inbox = createRoute({ getParentRoute: () => appRoute, path: '/inbox', component: InboxPage });
const simpleHome = createRoute({
  getParentRoute: () => appRoute,
  path: '/simple',
  component: SimpleHomePage,
});
const simplePerson = createRoute({
  getParentRoute: () => appRoute,
  path: '/simple/person/$id',
  component: SimplePersonPage,
});
const simpleTask = createRoute({
  getParentRoute: () => appRoute,
  path: '/simple/task/$id',
  component: SimpleTaskPage,
});
const groupsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/groups',
  loader: ({ context }) => void context.queryClient.prefetchQuery(groupsOptions),
  component: GroupsPage,
});
const group = createRoute({
  getParentRoute: () => appRoute,
  path: '/groups/$id',
  validateSearch: (s: Record<string, unknown>): GroupSearch => ({
    who: s.who === 'mine' || s.who === 'unassigned' ? s.who : undefined,
    done: s.done === '1' ? '1' : undefined,
    invite: s.invite === '1' ? '1' : undefined,
    task: str(s.task),
  }),
  component: GroupPage,
});
const groupSettings = createRoute({
  getParentRoute: () => appRoute,
  path: '/groups/$id/settings',
  component: GroupSettingsPage,
});
const admin = createRoute({
  getParentRoute: () => appRoute,
  path: '/admin',
  validateSearch: (s: Record<string, unknown>): { status?: string; report?: string } => ({
    status: str(s.status),
    report: str(s.report),
  }),
  component: AdminPage,
});
/** Invite links. Works signed out (shows the group and asks to log in or sign up). */
const join = createRoute({
  getParentRoute: () => rootRoute,
  path: '/join/$code',
  component: JoinPage,
});
const welcome = createRoute({
  getParentRoute: () => appRoute,
  path: '/welcome',
  component: WelcomePage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  guestRoute.addChildren([signIn, signUp, verify, forgot, reset]),
  appRoute.addChildren([
    today,
    tasks,
    newTask,
    voiceTask,
    inbox,
    simpleHome,
    simplePerson,
    simpleTask,
    taskDetail,
    editTask,
    settings,
    groupsRoute,
    group,
    groupSettings,
    admin,
    welcome,
  ]),
  suspended,
  legal,
  join,
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
