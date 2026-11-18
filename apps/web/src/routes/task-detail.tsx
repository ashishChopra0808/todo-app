import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ActivityDto, TaskDto } from '@todo/shared';
import { ApiError } from '../api/client';
import { useActivity, useDeleteTask, useMe, useTask, useToggleStatus } from '../api/queries';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { ErrorState, LoadingList, Spinner } from '../components/States';
import { PriorityDot, StatusPill } from '../components/TaskBits';
import { useToast } from '../components/Toasts';
import { errorMessage } from '../lib/errors';
import { formatDateTime, formatDue } from '../lib/format';
import { intlLocale } from '../lib/i18n';

function activityText(a: ActivityDto, meId: string, t: ReturnType<typeof useTranslation>['t']) {
  const name = a.actor
    ? a.actor.id === meId
      ? t('task.activity.you')
      : a.actor.name
    : t('task.activity.someone');
  switch (a.type) {
    case 'title_changed':
      return t('task.activity.title_changed', { name, to: String(a.to ?? '') });
    case 'priority_changed':
      return t('task.activity.priority_changed', { name, to: t(`task.priority.${String(a.to)}`) });
    case 'status_changed':
      return t('task.activity.status_changed', { name, to: t(`task.status.${String(a.to)}`) });
    case 'due_changed':
      return a.to
        ? t('task.activity.due_changed', { name })
        : t('task.activity.due_removed', { name });
    default:
      return t(`task.activity.${a.type}`, { name });
  }
}

function Activity({ task, meId, tz }: { task: TaskDto; meId: string; tz: string }) {
  const { t } = useTranslation();
  const activity = useActivity(task.id);
  return (
    <section className="stack" aria-labelledby="activity-title">
      <h2 id="activity-title" className="section-title">
        {t('task.detail.activity')}
      </h2>
      {activity.isPending ? (
        <LoadingList rows={2} />
      ) : activity.isError ? (
        <ErrorState
          message={errorMessage(activity.error, t)}
          onRetry={() => void activity.refetch()}
        />
      ) : (
        <ol className="activity">
          {activity.data.map((a) => (
            <li key={a.id}>
              <span>{activityText(a, meId, t)}</span>
              <time className="meta" dateTime={a.createdAt}>
                {formatDateTime(a.createdAt, tz, intlLocale())}
              </time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function TaskDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const { id } = useParams({ strict: false }) as { id: string };
  const me = useMe();
  const tz = me.data?.timeZone ?? 'Asia/Kolkata';
  const task = useTask(id);
  const toggle = useToggleStatus();
  const remove = useDeleteTask();
  const [confirm, setConfirm] = useState(false);

  const back = (
    <Link
      to="/tasks"
      className="btn btn--ghost btn--small"
      style={{ alignSelf: 'flex-start', paddingInline: 4 }}
    >
      <Icon name="chevronLeft" size={20} />
      {t('common.back')}
    </Link>
  );

  if (task.isPending) {
    return (
      <main id="main" className="page">
        {back}
        <LoadingList rows={3} />
      </main>
    );
  }
  if (task.isError) {
    const notFound = task.error instanceof ApiError && task.error.status === 404;
    return (
      <main id="main" className="page">
        {back}
        <ErrorState
          message={notFound ? t('task.detail.notFound') : errorMessage(task.error, t)}
          onRetry={notFound ? undefined : () => void task.refetch()}
        />
      </main>
    );
  }

  const data = task.data;
  const done = data.status === 'done';
  const due = formatDue(data, tz, intlLocale(), t);

  return (
    <main id="main" className="page">
      {back}
      <header className="stack">
        <h1
          className="screen-title"
          style={
            done ? { textDecoration: 'line-through', color: 'var(--color-text-muted)' } : undefined
          }
        >
          {data.title}
        </h1>
        <div className="row">
          <StatusPill status={data.status} />
          <span className="meta">{t('task.personal')}</span>
        </div>
      </header>

      {data.permissions.changeStatus && (
        <button
          type="button"
          className={`btn btn--block ${done ? 'btn--secondary' : 'btn--primary'}`}
          aria-pressed={done}
          disabled={toggle.isPending}
          onClick={() =>
            toggle.mutate(data, {
              onSuccess: (next) =>
                toast(next.status === 'done' ? t('task.markedDone') : t('task.markedNotDone')),
              onError: (err) => toast(errorMessage(err, t), { tone: 'error' }),
            })
          }
        >
          <Icon name="check" size={18} />
          {done ? t('task.markNotDoneShort') : t('task.markDoneShort')}
        </button>
      )}

      <dl className="detail-meta card">
        <dt>{t('task.fields.when')}</dt>
        <dd style={due.overdue ? { color: 'var(--color-alert)', fontWeight: 500 } : undefined}>
          <Icon name="clock" size={16} />
          {due.label}
          {due.overdue && ` · ${t('task.due.overdue')}`}
        </dd>
        <dt>{t('task.fields.priority')}</dt>
        <dd>
          <PriorityDot priority={data.priority} />
        </dd>
      </dl>

      {data.description && (
        <section className="stack" aria-labelledby="desc-title">
          <h2 id="desc-title" className="section-title">
            {t('task.fields.description')}
          </h2>
          <p className="description">{data.description}</p>
        </section>
      )}

      {(data.permissions.edit || data.permissions.delete) && (
        <div className="row">
          {data.permissions.edit && (
            <Link to="/tasks/$id/edit" params={{ id }} className="btn btn--secondary btn--small">
              <Icon name="pencil" size={18} />
              {t('common.edit')}
            </Link>
          )}
          {data.permissions.delete && (
            <button
              type="button"
              className="btn btn--danger-ghost btn--small"
              onClick={() => setConfirm(true)}
            >
              <Icon name="trash" size={18} />
              {t('task.delete.button')}
            </button>
          )}
        </div>
      )}

      <Activity task={data} meId={me.data?.id ?? ''} tz={tz} />
      <p className="meta">
        {t('task.detail.createdAt', { date: formatDateTime(data.createdAt, tz, intlLocale()) })}
      </p>

      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t('task.delete.title')}
        role="alertdialog"
      >
        <p className="muted">{t('task.delete.body')}</p>
        <div className="modal__actions">
          <button
            type="button"
            className="btn btn--danger btn--block"
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate(id, {
                onSuccess: () => {
                  toast(t('task.delete.done'));
                  void navigate({ to: '/tasks', replace: true });
                },
                onError: (err) => toast(errorMessage(err, t), { tone: 'error' }),
              })
            }
          >
            {remove.isPending && <Spinner />}
            {t('task.delete.confirm')}
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--block"
            onClick={() => setConfirm(false)}
          >
            {t('common.cancel')}
          </button>
        </div>
      </Dialog>
    </main>
  );
}
