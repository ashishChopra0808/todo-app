import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMe, useTaskCounts } from '../api/queries';
import { applyLocale } from '../lib/i18n';
import { applyTheme } from '../lib/theme';
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
        <NavLinks />
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
