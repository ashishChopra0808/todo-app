import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ActivityDto, TaskDto, TaskStatus } from '@todo/shared';
import { ApiError } from '../api/client';
import {
  useActivity,
  useDeleteTask,
  useMe,
  useTask,
  useToggleStatus,
  useUpdateTask,
} from '../api/queries';
import { Comments } from '../components/Comments';
import { Dialog } from '../components/Dialog';
import { Segmented } from '../components/Field';
import { GroupIcon, MiniAvatar } from '../components/GroupBits';
import { Icon } from '../components/Icon';
import { MoreMenu } from '../components/MoreMenu';
import { ReportDialog } from '../components/ReportDialog';
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
    case 'assigned': {
      const to = a.to as { id: string; name: string } | null;
      return t('task.activity.assigned', {
        name,
        to: to ? (to.id === meId ? t('task.activity.youLower') : to.name) : '',
      });
    }
    case 'unassigned': {
      const from = a.from as { id: string; name: string } | null;
      return from
        ? t('task.activity.unassignedFrom', {
            name,
            from: from.id === meId ? t('task.activity.youLower') : from.name,
          })
        : t('task.activity.unassigned', { name });
    }
    case 'moved': {
      const to = a.to as { name: string } | null;
      return to
        ? t('task.activity.moved', { name, to: to.name })
        : t('task.activity.movedPersonal', { name });
    }
    default:
      return t(`task.activity.${a.type}`, { name });
  }
}

function Activity({ task, meId, tz }: { task: TaskDto; meId: string; tz: string }) {
  const { t } = useTranslation();
  const activity = useActivity(task.id);
  const headingId = `activity-${task.id}`;
  return (
    <section className="stack" aria-labelledby={headingId}>
      <h3 id={headingId} className="section-title">
        {t('task.detail.activity')}
      </h3>
      {activity.isPending ? (
        <LoadingList rows={2} />
      ) : activity.isError ? (
        <ErrorState
          message={errorMessage(activity.error, t)}
          onRetry={() => void activity.refetch()}
        />
      ) : (
        <ol className="activity">
          {activity.data
            .filter((a) => a.type !== 'commented') // the thread above already shows comments
            .map((a) => (
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

interface DetailProps {
  id: string;
  /** "page": full screen (phones, direct links). "panel": right-hand panel beside the list (wide screens). */
  variant: 'page' | 'panel';
  onClose?: () => void;
  onDeleted: () => void;
}

/** Task details, shared by the full page and the desktop side panel. */
export function TaskDetail({ id, variant, onClose, onDeleted }: DetailProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const me = useMe();
  const tz = me.data?.timeZone ?? 'Asia/Kolkata';
  const task = useTask(id);
  const toggle = useToggleStatus();
  const update = useUpdateTask();
  const remove = useDeleteTask();
  const [confirm, setConfirm] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [localStatus, setLocalStatus] = useState<{ status: TaskStatus; version: number }>({
    status: 'todo',
    version: -1,
  });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const isPanel = variant === 'panel';

  // When the panel opens a different task, move focus to its title so screen-reader and keyboard users follow.
  useEffect(() => {
    if (isPanel && task.data) headingRef.current?.focus();
  }, [isPanel, id, task.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = isPanel && onClose && (
    <button type="button" className="icon-btn" aria-label={t('task.panel.close')} onClick={onClose}>
      <Icon name="x" size={20} />
    </button>
  );

  if (task.isPending) return <LoadingList rows={3} />;
  if (task.isError) {
    const notFound = task.error instanceof ApiError && task.error.status === 404;
    return (
      <>
        {close}
        <ErrorState
          message={notFound ? t('task.detail.notFound') : errorMessage(task.error, t)}
          onRetry={notFound ? undefined : () => void task.refetch()}
        />
      </>
    );
  }

  const data = task.data;
  const done = data.status === 'done';
  const due = formatDue(data, tz, intlLocale(), t);
  const Heading = isPanel ? 'h2' : 'h1';
  const meId = me.data?.id ?? '';
  const nameOf = (u: TaskDto['createdBy']) =>
    !u ? '—' : u.id === meId ? t('task.activity.you') : u.name;

  return (
    <>
      <header className="stack">
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
          {data.group ? (
            <Link to="/groups/$id" params={{ id: data.group.id }} className="meta task-group-link">
              <GroupIcon group={data.group} size="sm" />
              {data.group.name}
            </Link>
          ) : (
            <span className="meta">{t('task.personal')}</span>
          )}
          <span className="row" style={{ flexWrap: 'nowrap', gap: 4 }}>
            <MoreMenu
              label={t('task.more')}
              actions={
                data.permissions.report
                  ? [
                      {
                        id: 'report',
                        label: t('task.report'),
                        icon: 'flag',
                        onAction: () => setReporting(true),
                      },
                    ]
                  : []
              }
            />
            {close}
          </span>
        </div>
        <Heading
          ref={headingRef}
          tabIndex={-1}
          className={isPanel ? 'panel-title' : 'screen-title'}
          style={
            done ? { textDecoration: 'line-through', color: 'var(--color-text-muted)' } : undefined
          }
        >
          {data.title}
        </Heading>
        {!isPanel && (
          <div className="row">
            <StatusPill status={data.status} />
          </div>
        )}
      </header>

      {data.permissions.changeStatus &&
        (isPanel ? (
          <Segmented<TaskStatus>
            legend={t('task.fields.status')}
            legendHidden
            name={`status-${data.id}`}
            value={localStatus.version === data.version ? localStatus.status : data.status}
            onChange={(status) => {
              // Shown immediately; the server's answer (new version) takes over when it arrives.
              setLocalStatus({ status, version: data.version });
              update.mutate(
                { id: data.id, version: data.version, status },
                {
                  onError: (err) => {
                    setLocalStatus({ status: data.status, version: data.version });
                    toast(errorMessage(err, t), { tone: 'error' });
                  },
                },
              );
            }}
            options={(['todo', 'in_progress', 'done'] as const).map((s) => ({
              value: s,
              label: t(`task.status.${s}`),
            }))}
          />
        ) : (
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
        ))}

      <dl className={isPanel ? 'detail-grid' : 'detail-meta card'}>
        <div>
          <dt>{t('task.fields.when')}</dt>
          <dd style={due.overdue ? { color: 'var(--color-alert)', fontWeight: 500 } : undefined}>
            <Icon name="clock" size={16} />
            {due.label}
            {due.overdue && ` · ${t('task.due.overdue')}`}
          </dd>
        </div>
        <div>
          <dt>{t('task.fields.priority')}</dt>
          <dd>
            <PriorityDot priority={data.priority} />
          </dd>
        </div>
        {(isPanel || data.group) && (
          <>
            <div>
              <dt>{t('task.fields.assignee')}</dt>
              <dd>
                {data.assignee ? (
                  <>
                    <MiniAvatar person={data.assignee} size={22} />
                    {nameOf(data.assignee)}
                  </>
                ) : (
                  t('task.unassigned')
                )}
              </dd>
            </div>
            <div>
              <dt>{t('task.fields.createdBy')}</dt>
              <dd>{nameOf(data.createdBy)}</dd>
            </div>
          </>
        )}
      </dl>

      {data.description && (
        <section className="stack" aria-labelledby={`desc-${data.id}`}>
          <h3 id={`desc-${data.id}`} className="section-title">
            {t('task.fields.description')}
          </h3>
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

      <Comments task={data} meId={meId} tz={tz} />
      <Activity task={data} meId={meId} tz={tz} />
      <ReportDialog
        open={reporting}
        onClose={() => setReporting(false)}
        target={{ type: 'task', id: data.id }}
      />
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
            onClick={async () => {
              try {
                await remove.mutateAsync(id);
              } catch (err) {
                toast(errorMessage(err, t), { tone: 'error' });
                return;
              }
              setConfirm(false);
              toast(t('task.delete.done'));
              onDeleted();
            }}
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
    </>
  );
}

export function TaskDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams({ strict: false }) as { id: string };
  return (
    <main id="main" className="page">
      <Link
        to="/tasks"
        className="btn btn--ghost btn--small"
        style={{ alignSelf: 'flex-start', paddingInline: 4 }}
      >
        <Icon name="chevronLeft" size={20} />
        {t('common.back')}
      </Link>
      <TaskDetail
        id={id}
        variant="page"
        onDeleted={() => void navigate({ to: '/tasks', replace: true })}
      />
    </main>
  );
}
