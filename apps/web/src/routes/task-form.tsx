import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LIMITS,
  fromDueAt,
  localDate,
  toDueAt,
  type TaskDto,
  type TaskPriority,
  type TaskStatus,
} from '@todo/shared';
import { ApiError } from '../api/client';
import { useCreateTask, useMe, useTask, useUpdateTask } from '../api/queries';
import { FormError, Segmented } from '../components/Field';
import { Icon } from '../components/Icon';
import { ErrorState, LoadingList, Spinner } from '../components/States';
import { useToast } from '../components/Toasts';
import { errorMessage, fieldErrors } from '../lib/errors';
import { addDaysIso } from '../lib/format';

type When = 'none' | 'today' | 'tomorrow' | 'weekend' | 'pick';

function weekendDate(today: string) {
  const day = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 Sun … 6 Sat
  if (day === 6 || day === 0) return today;
  return addDaysIso(today, 6 - day);
}

function initialWhen(date: string | null, today: string): When {
  if (!date) return 'none';
  if (date === today) return 'today';
  if (date === addDaysIso(today, 1)) return 'tomorrow';
  return 'pick';
}

function TaskForm({ task, onDone }: { task?: TaskDto; onDone: (t: TaskDto) => void }) {
  const { t } = useTranslation();
  const me = useMe();
  const tz = me.data?.timeZone ?? 'Asia/Kolkata';
  const today = localDate(tz);
  const initial = task?.dueAt
    ? fromDueAt(task.dueAt, task.dueHasTime, tz)
    : { date: null as string | null, time: null as string | null };
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [when, setWhen] = useState<When>(initialWhen(initial.date, today));
  const [pickDate, setPickDate] = useState(initial.date ?? today);
  const [time, setTime] = useState<string | null>(initial.time);
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 'medium');
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'todo');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const create = useCreateTask();
  const update = useUpdateTask();
  const busy = create.isPending || update.isPending;

  const date =
    when === 'none'
      ? null
      : when === 'today'
        ? today
        : when === 'tomorrow'
          ? addDaysIso(today, 1)
          : when === 'weekend'
            ? weekendDate(today)
            : pickDate;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setFields({ title: t('errors.field.required') });
      document.getElementById('task-title')?.focus();
      return;
    }
    setFields({});
    setError(null);
    const dueAt = date ? toDueAt(date, time, tz) : null;
    const body = {
      title,
      description: description || null,
      dueAt,
      dueHasTime: !!(date && time),
      priority,
      status,
    };
    try {
      const saved = task
        ? await update.mutateAsync({ id: task.id, version: task.version, ...body })
        : await create.mutateAsync(body);
      onDone(saved);
    } catch (err) {
      setFields(fieldErrors(err, t));
      setError(errorMessage(err, t));
      if (err instanceof ApiError && err.code === 'conflict') onDone(err.details as TaskDto);
    }
  }

  const whenOptions: Array<{ value: When; label: string }> = [
    { value: 'none', label: t('task.when.none') },
    { value: 'today', label: t('task.when.today') },
    { value: 'tomorrow', label: t('task.when.tomorrow') },
    { value: 'weekend', label: t('task.when.weekend') },
    { value: 'pick', label: t('task.when.pick') },
  ];

  return (
    <form className="form" onSubmit={submit} noValidate style={{ gap: 24 }}>
      <div className="stack">
        <label htmlFor="task-title" className="visually-hidden">
          {t('task.fields.title')}
        </label>
        <input
          id="task-title"
          className="title-input"
          placeholder={t('task.fields.titlePlaceholder')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={LIMITS.taskTitle}
          autoFocus={!task}
          aria-invalid={!!fields.title || undefined}
          aria-describedby={fields.title ? 'title-error' : undefined}
          enterKeyHint="done"
        />
        {fields.title && (
          <p id="title-error" className="field__error">
            <Icon name="alert" size={16} />
            {fields.title}
          </p>
        )}
        <label htmlFor="task-desc" className="visually-hidden">
          {t('task.fields.description')}
        </label>
        <textarea
          id="task-desc"
          className="input"
          rows={3}
          placeholder={t('task.fields.descriptionPlaceholder')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={LIMITS.taskDescription}
        />
      </div>

      <fieldset className="fieldset">
        <legend className="section-title">{t('task.fields.when')}</legend>
        <div className="chips">
          {whenOptions.map((o) => (
            <label key={o.value} className="chip">
              <input
                type="radio"
                name="when"
                value={o.value}
                checked={when === o.value}
                onChange={() => setWhen(o.value)}
              />
              <span>
                {o.value === 'pick' && <Icon name="calendar" size={18} />}
                {o.label}
              </span>
            </label>
          ))}
        </div>
        {when === 'pick' && (
          <div className="field">
            <label htmlFor="task-date" className="field__label">
              {t('task.fields.date')}
            </label>
            <input
              id="task-date"
              type="date"
              className="input"
              value={pickDate}
              onChange={(e) => setPickDate(e.target.value)}
              required
            />
          </div>
        )}
        {date &&
          (time === null ? (
            <button
              type="button"
              className="text-link"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => setTime('09:00')}
            >
              {t('task.when.addTime')}
            </button>
          ) : (
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="task-time" className="field__label">
                  {t('task.fields.time')}
                </label>
                <input
                  id="task-time"
                  type="time"
                  className="input"
                  value={time}
                  onChange={(e) => setTime(e.target.value || null)}
                />
              </div>
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={() => setTime(null)}
              >
                {t('task.when.removeTime')}
              </button>
            </div>
          ))}
      </fieldset>

      <Segmented
        legend={t('task.fields.priority')}
        name="priority"
        value={priority}
        onChange={setPriority}
        options={(['low', 'medium', 'high'] as const).map((p) => ({
          value: p,
          label: (
            <>
              <span className={`dot dot--${p}`} aria-hidden="true" />
              {t(`task.priority.${p}`)}
            </>
          ),
        }))}
      />

      {task && (
        <Segmented
          legend={t('task.fields.status')}
          name="status"
          value={status}
          onChange={setStatus}
          options={(['todo', 'in_progress', 'done'] as const).map((s) => ({
            value: s,
            label: t(`task.status.${s}`),
          }))}
        />
      )}

      <FormError message={error} />
      <div className="sticky-actions">
        <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
          {busy && <Spinner />}
          {task ? t('task.saveChanges') : t('task.create')}
        </button>
      </div>
    </form>
  );
}

function FormHeader({ title, cancelTo }: { title: string; cancelTo: () => void }) {
  const { t } = useTranslation();
  return (
    <header className="page-header" style={{ alignItems: 'center' }}>
      <button
        type="button"
        className="btn btn--ghost btn--small"
        onClick={cancelTo}
        style={{ paddingInline: 4 }}
      >
        {t('common.cancel')}
      </button>
      <h1 style={{ fontSize: 17, fontWeight: 600 }}>{title}</h1>
      <span style={{ inlineSize: 64 }} aria-hidden="true" />
    </header>
  );
}

export function NewTaskPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const back = () =>
    window.history.length > 1 ? window.history.back() : void navigate({ to: '/today' });
  return (
    <main id="main" className="page" style={{ paddingBlockEnd: 32 }}>
      <FormHeader title={t('task.new')} cancelTo={back} />
      <TaskForm
        onDone={() => {
          toast(t('task.created'));
          back();
        }}
      />
    </main>
  );
}

export function EditTaskPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const { id } = useParams({ strict: false }) as { id: string };
  const task = useTask(id);
  const toDetail = () => void navigate({ to: '/tasks/$id', params: { id }, replace: true });
  return (
    <main id="main" className="page" style={{ paddingBlockEnd: 32 }}>
      <FormHeader title={t('task.editTitle')} cancelTo={toDetail} />
      {task.isPending ? (
        <LoadingList rows={3} />
      ) : task.isError ? (
        <ErrorState message={errorMessage(task.error, t)} />
      ) : !task.data.permissions.edit ? (
        <ErrorState message={t('errors.forbidden')} />
      ) : (
        <TaskForm
          key={task.data.version}
          task={task.data}
          onDone={(saved) => {
            if (saved.version !== task.data.version) toast(t('task.saved'));
            toDetail();
          }}
        />
      )}
      <Link to="/tasks/$id" params={{ id }} className="visually-hidden">
        {t('task.detail.back')}
      </Link>
    </main>
  );
}
