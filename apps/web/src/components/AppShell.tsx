import { Link, Outlet, useRouterState, useSearch } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMe, useTaskCounts } from '../api/queries';
import { applyLocale } from '../lib/i18n';
import { applyTheme } from '../lib/theme';
import { Avatar } from './Avatar';
import { Icon, type IconName } from './Icon';

function NavLinks() {
  const { t } = useTranslation();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const counts = useTaskCounts();
  const items: Array<{
    to: '/today' | '/tasks' | '/settings';
    label: string;
    icon: IconName;
    badge?: number;
  }> = [
    { to: '/today', label: t('nav.today'), icon: 'sun', badge: counts.data?.overdue || undefined },
    { to: '/tasks', label: t('nav.tasks'), icon: 'list' },
    { to: '/settings', label: t('nav.settings'), icon: 'settings' },
  ];
  return (
    <>
      {items.map((i) => {
        const current = path === i.to || (i.to === '/tasks' && path.startsWith('/tasks'));
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
  const views: Array<{
    key: string;
    label: string;
    to: '/today' | '/tasks';
    tab?: 'overdue' | 'completed';
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
      </ul>
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
  const path = useRouterState({ select: (s) => s.location.pathname });

  // The profile is the source of truth for language and theme once signed in.
  useEffect(() => {
    if (!me.data) return;
    applyTheme(me.data.theme);
    applyLocale(me.data.locale);
  }, [me.data]);

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
        <Outlet />
      </div>
      {showFab && (
        <div className="fab-row">
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
