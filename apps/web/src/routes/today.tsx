import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { isOverdue } from '@todo/shared';
import { useMe, useTaskList } from '../api/queries';
import { Avatar } from '../components/Avatar';
import { EmptyState, ErrorState, LoadingList } from '../components/States';
import { TaskRow } from '../components/TaskBits';
import { errorMessage } from '../lib/errors';
import { formatLongToday, greetingKey } from '../lib/format';
import { intlLocale } from '../lib/i18n';

export function TodayPage() {
  const { t } = useTranslation();
  const me = useMe();
  const tz = me.data?.timeZone ?? 'Asia/Kolkata';
  const list = useTaskList({ view: 'today', limit: 100 });
  const items = list.data?.items ?? [];
  const overdue = items.filter((x) => isOverdue(x, tz));
  const dueToday = items.filter((x) => !isOverdue(x, tz) && x.status !== 'done');
  const doneToday = items.filter((x) => x.status === 'done');
  const totalToday = dueToday.length + doneToday.length;
  const firstName = (me.data?.name ?? '').split(' ')[0] ?? '';

  return (
    <main id="main" className="page">
      <header className="page-header">
        <div className="page-header__titles">
          <p className="eyebrow">{formatLongToday(tz, intlLocale())}</p>
          <h1 className="screen-title">{t(greetingKey(tz), { name: firstName })}</h1>
        </div>
        <div className="row">
          <Link
            to="/tasks"
            search={{ focus: 'search' }}
            className="icon-btn"
            aria-label={t('tasks.search.label')}
          >
            <svg
              aria-hidden="true"
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </Link>
          <Link to="/settings" aria-label={t('nav.profile')} style={{ borderRadius: 22 }}>
            <Avatar name={me.data?.name ?? ''} url={me.data?.avatarUrl ?? null} />
          </Link>
        </div>
      </header>

      {list.isPending ? (
        <LoadingList rows={4} />
      ) : list.isError ? (
        <ErrorState message={errorMessage(list.error, t)} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          title={t('today.empty.title')}
          body={t('today.empty.body')}
          action={
            <Link to="/tasks/new" className="btn btn--primary">
              {t('today.empty.action')}
            </Link>
          }
        />
      ) : (
        <>
          {totalToday > 0 && (
            <section
              className="card progress"
              aria-label={t('today.progress', { done: doneToday.length, count: totalToday })}
            >
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <p style={{ fontWeight: 600 }}>
                  {t('today.progress', { done: doneToday.length, count: totalToday })}
                </p>
                {overdue.length > 0 && (
                  <p className="meta" style={{ color: 'var(--color-alert)', fontWeight: 500 }}>
                    {t('today.overdueCount', { count: overdue.length })}
                  </p>
                )}
              </div>
              <div className="progress__bar" aria-hidden="true">
                <div
                  className="progress__fill"
                  style={{ inlineSize: `${Math.round((doneToday.length / totalToday) * 100)}%` }}
                />
              </div>
            </section>
          )}
          {overdue.length > 0 && (
            <section className="stack" aria-labelledby="sec-overdue">
              <h2 id="sec-overdue" className="section-title section-title--alert">
                {t('today.sections.overdue')}
              </h2>
              <ul className="task-list">
                {overdue.map((task) => (
                  <TaskRow key={task.id} task={task} tz={tz} />
                ))}
              </ul>
            </section>
          )}
          {dueToday.length > 0 && (
            <section className="stack" aria-labelledby="sec-today">
              <h2 id="sec-today" className="section-title">
                {t('today.sections.today')}
              </h2>
              <ul className="task-list">
                {dueToday.map((task) => (
                  <TaskRow key={task.id} task={task} tz={tz} />
                ))}
              </ul>
            </section>
          )}
          {doneToday.length > 0 && (
            <section className="stack" aria-labelledby="sec-done">
              <h2 id="sec-done" className="section-title">
                {t('today.sections.done')}
              </h2>
              <ul className="task-list">
                {doneToday.map((task) => (
                  <TaskRow key={task.id} task={task} tz={tz} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}
