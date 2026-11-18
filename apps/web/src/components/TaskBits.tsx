import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { TaskDto, TaskPriority, TaskStatus } from '@todo/shared';
import { useToggleStatus } from '../api/queries';
import { errorMessage } from '../lib/errors';
import { formatDue } from '../lib/format';
import { intlLocale } from '../lib/i18n';
import { Icon } from './Icon';
import { useToast } from './Toasts';

export function PriorityDot({
  priority,
  withLabel = true,
}: {
  priority: TaskPriority;
  withLabel?: boolean;
}) {
  const { t } = useTranslation();
  const label = t(`task.priority.${priority}`);
  return (
    <span className="task-meta__item">
      <span className={`dot dot--${priority}`} aria-hidden="true" />
      {withLabel ? (
        label
      ) : (
        <span className="visually-hidden">{t('task.priority.label', { priority: label })}</span>
      )}
    </span>
  );
}

export function StatusPill({ status }: { status: TaskStatus }) {
  const { t } = useTranslation();
  return <span className={`pill pill--${status}`}>{t(`task.status.${status}`)}</span>;
}

/** The round tick button. Optimistic: flips instantly, rolls back with a message on failure. */
export function TickButton({ task }: { task: TaskDto }) {
  const { t } = useTranslation();
  const toast = useToast();
  const toggle = useToggleStatus();
  const done = task.status === 'done';
  return (
    <button
      type="button"
      className="tick"
      aria-pressed={done}
      aria-label={
        done
          ? t('task.markNotDone', { title: task.title })
          : t('task.markDone', { title: task.title })
      }
      disabled={!task.permissions.changeStatus}
      onClick={() =>
        toggle.mutate(task, {
          onSuccess: (next) =>
            toast(next.status === 'done' ? t('task.markedDone') : t('task.markedNotDone')),
          onError: (err) => toast(errorMessage(err, t), { tone: 'error' }),
        })
      }
    >
      <span className="tick__circle">{done && <Icon name="check" size={14} />}</span>
    </button>
  );
}

export function TaskRow({ task, tz }: { task: TaskDto; tz: string }) {
  const { t } = useTranslation();
  const due = formatDue(task, tz, intlLocale(), t);
  return (
    <li className="task-row" data-done={task.status === 'done'}>
      <TickButton task={task} />
      <Link to="/tasks/$id" params={{ id: task.id }} className="task-row__link">
        <span className="task-row__title">{task.title}</span>
        <span className="task-meta">
          {task.dueAt && (
            <span className={`task-meta__item${due.overdue ? ' task-meta__item--alert' : ''}`}>
              <Icon name="clock" size={14} />
              {due.label}
              {due.overdue && <span className="visually-hidden"> ({t('task.due.overdue')})</span>}
            </span>
          )}
          {task.status === 'in_progress' && <StatusPill status="in_progress" />}
          {task.priority !== 'medium' && <PriorityDot priority={task.priority} />}
        </span>
      </Link>
    </li>
  );
}
