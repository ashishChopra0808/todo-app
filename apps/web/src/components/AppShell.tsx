import { Link, Outlet, useNavigate, useRouterState, useSearch } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOnline, usePendingSync } from '../api/offline';
import { useGroups, useMe, useTaskCounts, useUnreadCount } from '../api/queries';
import { takePendingJoin } from '../lib/pending-join';
import { applyLocale } from '../lib/i18n';
import { applyTheme } from '../lib/theme';
import { Avatar } from './Avatar';
import { GroupIcon } from './GroupBits';
import { Icon, type IconName } from './Icon';
import { NewGroupDialog } from './NewGroupDialog';

function NavLinks() {
  const { t } = useTranslation();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const counts = useTaskCounts();
  const unread = useUnreadCount();
  const items: Array<{
    to: '/today' | '/tasks' | '/groups' | '/inbox' | '/settings';
    label: string;
    icon: IconName;
    badge?: number;
  }> = [
    { to: '/today', label: t('nav.today'), icon: 'sun', badge: counts.data?.overdue || undefined },
    { to: '/tasks', label: t('nav.tasks'), icon: 'list' },
    { to: '/groups', label: t('nav.groups'), icon: 'users' },
    { to: '/inbox', label: t('nav.inbox'), icon: 'bell', badge: unread.data?.count || undefined },
    { to: '/settings', label: t('nav.settings'), icon: 'settings' },
  ];
  return (
    <>
      {items.map((i) => {
        const current =
          path === i.to ||
          (i.to === '/tasks' && path.startsWith('/tasks')) ||
          (i.to === '/groups' && path.startsWith('/groups'));
        return (
          <Link
            key={i.to}
            to={i.to}
            className="nav-link"
            aria-current={current ? 'page' : undefined}
          >
            <Icon name={i.icon} size={24} />
            {i.label}
            {i.badge ? (
              <span className="nav-badge">
                {i.badge}
                <span className="visually-hidden"> {t('task.due.overdue')}</span>
              </span>
            ) : null}
          </Link>
        );
      })}
    </>
  );
}

/** Desktop sidebar: views with live counts (as in the desktop design), profile card at the bottom. */
function SidebarNav() {
  const { t } = useTranslation();
  const me = useMe();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const search = useSearch({ strict: false }) as { tab?: string };
  const counts = useTaskCounts().data;
  const tab = path === '/tasks' ? (search.tab ?? 'mine') : null;
  const groups = useGroups();
  const unread = useUnreadCount();
  const [creating, setCreating] = useState(false);
  const views: Array<{
    key: string;
    label: string;
    to: '/today' | '/tasks';
    tab?: 'overdue' | 'completed' | 'assigned_by_me';
    count?: number;
    alert?: boolean;
    current: boolean;
  }> = [
    {
      key: 'today',
      label: t('nav.today'),
      to: '/today',
      count: counts ? counts.today + counts.overdue : undefined,
      current: path === '/today',
    },
    {
      key: 'mine',
      label: t('nav.myTasks'),
      to: '/tasks',
      count: counts?.open,
      current: tab === 'mine',
    },
    {
      key: 'assigned_by_me',
      label: t('nav.assignedByMe'),
      to: '/tasks',
      tab: 'assigned_by_me',
      current: tab === 'assigned_by_me',
    },
    {
      key: 'overdue',
      label: t('nav.overdue'),
      to: '/tasks',
      tab: 'overdue',
      count: counts?.overdue || undefined,
      alert: true,
      current: tab === 'overdue',
    },
    {
      key: 'completed',
      label: t('nav.completed'),
      to: '/tasks',
      tab: 'completed',
      current: tab === 'completed',
    },
  ];
  return (
    <>
      <ul className="sidebar__views" aria-label={t('nav.views')}>
        {views.map((v) => (
          <li key={v.key}>
            <Link
              to={v.to}
              search={v.to === '/tasks' ? { tab: v.tab } : {}}
              className="nav-link"
              aria-current={v.current ? 'page' : undefined}
            >
              <span>{v.label}</span>
              {v.count !== undefined && (
                <span
                  className={v.alert ? 'sidebar__count sidebar__count--alert' : 'sidebar__count'}
                >
                  {v.count}
                </span>
              )}
            </Link>
          </li>
        ))}
        <li>
          <Link
            to="/inbox"
            className="nav-link"
            aria-current={path === '/inbox' ? 'page' : undefined}
          >
            <span>{t('nav.inbox')}</span>
            {!!unread.data?.count && <span className="sidebar__count">{unread.data.count}</span>}
          </Link>
        </li>
      </ul>
      <div className="sidebar__groups">
        <h2 className="sidebar__heading" id="sidebar-groups">
          <Link
            to="/groups"
            className="sidebar__heading-link"
            aria-current={path === '/groups' ? 'page' : undefined}
          >
            {t('nav.groups')}
          </Link>
        </h2>
        <ul className="sidebar__views" aria-labelledby="sidebar-groups">
          {groups.data?.map((g) => (
            <li key={g.id}>
              <Link
                to="/groups/$id"
                params={{ id: g.id }}
                className="nav-link"
                aria-current={path.startsWith(`/groups/${g.id}`) ? 'page' : undefined}
              >
                <span className="row" style={{ gap: 8, flexWrap: 'nowrap', minInlineSize: 0 }}>
                  <GroupIcon group={g} size="sm" />
                  <span className="sidebar__group-name">{g.name}</span>
                </span>
                {g.openTaskCount > 0 && <span className="sidebar__count">{g.openTaskCount}</span>}
              </Link>
            </li>
          ))}
          <li>
            <button
              type="button"
              className="nav-link sidebar__new"
              onClick={() => setCreating(true)}
            >
              <Icon name="plus" size={18} />
              {t('nav.newGroup')}
            </button>
          </li>
        </ul>
      </div>
      <NewGroupDialog open={creating} onClose={() => setCreating(false)} />
      <Link
        to="/settings"
        className="sidebar__me"
        aria-current={path === '/settings' ? 'page' : undefined}
      >
        <Avatar name={me.data?.name ?? ''} url={me.data?.avatarUrl ?? null} />
        <span className="stack" style={{ gap: 0 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{me.data?.name}</span>
          <span className="meta">{t('nav.settings')}</span>
        </span>
      </Link>
    </>
  );
}

/** Signed-in layout: skip link, sidebar (desktop) or bottom nav (phone), and the main New task button. */
export function AppShell() {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });

  // Someone opened an invite, then signed up or logged in: take them back to it.
  useEffect(() => {
    if (!me.data) return;
    const code = takePendingJoin();
    if (code) void navigate({ to: '/join/$code', params: { code }, replace: true });
  }, [me.data, navigate]);

  // The profile is the source of truth for language and theme once signed in.
  useEffect(() => {
    if (!me.data) return;
    applyTheme(me.data.theme);
    applyLocale(me.data.locale);
  }, [me.data]);

  // Simple mode replaces the whole app (Settings stays reachable, to switch it off).
  const simple = path.startsWith('/simple');
  useEffect(() => {
    if (me.data?.simpleMode && !simple && !path.startsWith('/settings'))
      void navigate({ to: '/simple', replace: true });
  }, [me.data?.simpleMode, simple, path, navigate]);

  const pending = usePendingSync();
  const online = useOnline();
  const banner = !online ? (
    <p className="offline-banner" role="status">
      <Icon name="wifiOff" size={18} />
      {pending.count ? t('offline.bannerPending', { count: pending.count }) : t('offline.banner')}
    </p>
  ) : null;

  if (simple)
    return (
      <>
        {banner}
        <Outlet />
      </>
    );

  const showFab = path === '/today' || path === '/tasks';
  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        {t('nav.skipToContent')}
      </a>
      <nav className="sidebar" aria-label={t('nav.main')}>
        <div className="sidebar__brand">
          <span className="brand-mark brand-mark--sm" aria-hidden="true">
            <Icon name="check" size={20} />
          </span>
          {t('app.name')}
        </div>
        <Link to="/tasks/new" className="btn btn--primary" style={{ marginBlockEnd: 16 }}>
          <Icon name="plus" />
          {t('nav.newTask')}
        </Link>
        <SidebarNav />
      </nav>
      <div>
        {banner}
        <Outlet />
      </div>
      {showFab && (
        <div className="fab-row">
          <Link
            to="/tasks/voice"
            className="btn btn--secondary btn--fab"
            aria-label={t('voice.title')}
          >
            <Icon name="mic" />
          </Link>
          <Link to="/tasks/new" className="btn btn--primary btn--fab">
            <Icon name="plus" />
            {t('nav.newTask')}
          </Link>
        </div>
      )}
      <nav className="bottom-nav" aria-label={t('nav.main')}>
        <NavLinks />
      </nav>
    </div>
  );
}
