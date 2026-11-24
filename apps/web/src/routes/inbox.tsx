import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { NotificationDto } from '@todo/shared';
import { useMarkNotification, useMe, useNotifications } from '../api/queries';
import { MiniAvatar } from '../components/GroupBits';
import { Icon } from '../components/Icon';
import { EmptyState, ErrorState, LoadingList, Spinner } from '../components/States';
import { errorMessage } from '../lib/errors';
import { formatDateTime } from '../lib/format';
import { intlLocale } from '../lib/i18n';

function Line({ n }: { n: NotificationDto }) {
  const { t } = useTranslation();
  const name = n.actor?.name || t('notify.someone');
  const task = n.task?.title ?? t('inbox.deletedTask');
  const status = typeof n.data.status === 'string' ? t(`task.status.${n.data.status}`) : '';
  switch (n.type) {
    case 'task_assigned':
      return <>{t('inbox.assigned', { name, task })}</>;
    case 'comment_added':
      return n.data.voice ? (
        <>{t('inbox.voiceReply', { name, task })}</>
      ) : (
        <>
          {t('inbox.commented', { name, task })}
          {typeof n.data.excerpt === 'string' && (
            <span className="inbox__excerpt">“{n.data.excerpt}”</span>
          )}
        </>
      );
    case 'status_changed':
      return <>{t('inbox.status', { name, task, status })}</>;
    case 'due_soon':
      return <>{t('inbox.dueSoon', { task })}</>;
    case 'overdue':
      return <>{t('inbox.overdue', { task })}</>;
  }
}

export function InboxPage() {
  const { t } = useTranslation();
  const me = useMe();
  const tz = me.data?.timeZone ?? 'Asia/Kolkata';
  const list = useNotifications();
  const mark = useMarkNotification();
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const unread = list.data?.pages[0]?.unreadCount ?? 0;

  return (
    <main id="main" className="page page--narrow">
      <header className="page-header">
        <h1 className="screen-title">{t('inbox.title')}</h1>
        {unread > 0 && (
          <button
            type="button"
            className="btn btn--secondary btn--small"
            disabled={mark.isPending}
            onClick={() => mark.mutate('all')}
          >
            <Icon name="check" size={18} />
            {t('inbox.readAll')}
          </button>
        )}
      </header>
      {list.isPending ? (
        <LoadingList rows={4} />
      ) : list.isError ? (
        <ErrorState message={errorMessage(list.error, t)} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon="bell" title={t('inbox.empty.title')} body={t('inbox.empty.body')} />
      ) : (
        <ul className="inbox">
          {items.map((n) => {
            const body = (
              <>
                {n.actor ? (
                  <MiniAvatar person={n.actor} size={36} />
                ) : (
                  <span className="inbox__icon" aria-hidden="true">
                    <Icon name={n.type === 'overdue' ? 'alert' : 'clock'} size={18} />
                  </span>
                )}
                <span className="inbox__text">
                  <span>
                    {!n.readAt && <span className="visually-hidden">{t('inbox.unread')}: </span>}
                    <Line n={n} />
                  </span>
                  <time className="meta" dateTime={n.createdAt}>
                    {formatDateTime(n.createdAt, tz, intlLocale())}
                  </time>
                </span>
                {!n.readAt && <span className="inbox__dot" aria-hidden="true" />}
              </>
            );
            return (
              <li
                key={n.id}
                className={n.readAt ? 'inbox__item' : 'inbox__item inbox__item--unread'}
              >
                {n.task ? (
                  <Link
                    to="/tasks/$id"
                    params={{ id: n.task.id }}
                    className="inbox__link"
                    onClick={() => !n.readAt && mark.mutate(n.id)}
                  >
                    {body}
                  </Link>
                ) : (
                  <div className="inbox__link">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {list.hasNextPage && (
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => void list.fetchNextPage()}
          disabled={list.isFetchingNextPage}
        >
          {list.isFetchingNextPage && <Spinner />}
          {t('tasks.loadMore')}
        </button>
      )}
    </main>
  );
}
