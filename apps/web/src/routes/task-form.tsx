import { onlineManager } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
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
import {
  useCreateTask,
  useGroups,
  useMe,
  useMembers,
  useTask,
  useUpdateTask,
  uploadAudio,
  type Recording,
} from '../api/queries';
import { useOnline } from '../api/offline';
import { FormError, Segmented, TextField } from '../components/Field';
import { AudioPlayer, Recorder, formatDuration } from '../components/Recorder';
import { intlLocale } from '../lib/i18n';
import { GroupIcon, MiniAvatar } from '../components/GroupBits';
import { Icon } from '../components/Icon';
import { ErrorState, LoadingList, Spinner } from '../components/States';
import { useToast } from '../components/Toasts';
import { errorMessage, fieldErrors } from '../lib/errors';
import { addDaysIso, formatDateTime } from '../lib/format';
import { WIDE_QUERY, useMediaQuery } from '../lib/useMediaQuery';

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

/** "Where & who": Personal or a group, then who in that group does it. */
function WhereAndWho({
  groupId,
  assigneeId,
  onGroup,
  onAssignee,
  canMove,
  canAssign,
  meId,
}: {
  groupId: string | null;
  assigneeId: string | null;
  onGroup: (id: string | null) => void;
  onAssignee: (id: string | null) => void;
  canMove: boolean;
  canAssign: boolean;
  meId: string;
}) {
  const { t } = useTranslation();
  const groups = useGroups();
  const members = useMembers(groupId);
  if (!groups.data?.length && !groupId) return null;
  const others = (members.data ?? []).filter((m) => m.id !== meId);
  return (
    <fieldset className="fieldset">
      <legend className="section-title">{t('task.where')}</legend>
      {canMove && (
        <fieldset className="fieldset">
          <legend className="field__label">{t('task.fields.group')}</legend>
          <div className="chips">
            <label className="chip">
              <input
                type="radio"
                name="task-group"
                checked={groupId === null}
                onChange={() => onGroup(null)}
              />
              <span>{t('task.personal')}</span>
            </label>
            {groups.data?.map((g) => (
              <label key={g.id} className="chip">
                <input
                  type="radio"
                  name="task-group"
                  checked={groupId === g.id}
                  onChange={() => onGroup(g.id)}
                />
                <span>
                  <GroupIcon group={g} size="sm" />
                  {g.name}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {groupId && canAssign && (
        <fieldset className="fieldset">
          <legend className="field__label">{t('task.fields.assignTo')}</legend>
          {members.isPending ? (
            <LoadingList rows={1} />
          ) : (
            <div className="chips">
              <label className="chip">
                <input
                  type="radio"
                  name="task-assignee"
                  checked={assigneeId === meId}
                  onChange={() => onAssignee(meId)}
                />
                <span>{t('task.me')}</span>
              </label>
              {others.map((m) => (
                <label key={m.id} className="chip">
                  <input
                    type="radio"
                    name="task-assignee"
                    checked={assigneeId === m.id}
                    onChange={() => onAssignee(m.id)}
                  />
                  <span>
                    <MiniAvatar person={m} size={22} />
                    {m.name}
                  </span>
                </label>
              ))}
              <label className="chip">
                <input
                  type="radio"
                  name="task-assignee"
                  checked={assigneeId === null}
                  onChange={() => onAssignee(null)}
                />
                <span>{t('task.unassigned')}</span>
              </label>
            </div>
          )}
        </fieldset>
      )}
    </fieldset>
  );
}

function TaskForm({
  task,
  initialGroup,
  onDone,
}: {
  task?: TaskDto;
  initialGroup?: string | null;
  /** The saved task; undefined when it was queued offline. */
  onDone: (t: TaskDto | undefined) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const me = useMe();
  const meId = me.data?.id ?? '';
  const [groupId, setGroupId] = useState<string | null>(
    task ? task.groupId : (initialGroup ?? null),
  );
  // New group tasks default to "Me"; the creator picks someone else with one tap.
  const [assigneeId, setAssigneeId] = useState<string | null>(
    task ? (task.assignee?.id ?? null) : meId || null,
  );
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
  // The version this edit started from. A refresh in the background doesn't touch what's being
  // typed; if someone else saved in between, the server says so and we move this up (below).
  const [baseVersion, setBaseVersion] = useState(task?.version);
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
    const where = task
      ? {
          ...(groupId !== task.groupId ? { groupId } : {}),
          ...(groupId && assigneeId !== (task.assignee?.id ?? null) ? { assigneeId } : {}),
        }
      : groupId
        ? { groupId, assigneeId }
        : {};
    if (!onlineManager.isOnline()) {
      if (task) {
        setError(t('offline.editNeedsConnection'));
        return;
      }
      // Offline: the task shows at once, marked "waiting to sync", and is sent later.
      const vars = { id: crypto.randomUUID(), ...body, ...where };
      create.mutate(vars);
      toast(t('offline.savedLater'));
      onDone(undefined);
      return;
    }
    try {
      const saved = task
        ? await update.mutateAsync({
            id: task.id,
            version: baseVersion ?? task.version,
            ...body,
            ...where,
          })
        : await create.mutateAsync({ id: crypto.randomUUID(), ...body, ...where });
      onDone(saved);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'conflict') {
        // Someone else saved first. Keep what this person typed (nothing is lost) and let them
        // save again on top of the latest version.
        const latest = err.details as TaskDto | undefined;
        if (latest) setBaseVersion(latest.version);
        setFields({});
        setError(t('task.conflictEditing'));
        return;
      }
      setFields(fieldErrors(err, t));
      setError(errorMessage(err, t));
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
          onChange={(e) => {
            setTitle(e.target.value);
            if (fields.title && e.target.value.trim()) setFields(({ title: _, ...rest }) => rest);
          }}
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

      <WhereAndWho
        groupId={groupId}
        assigneeId={assigneeId}
        meId={meId}
        canMove={!task || task.permissions.move}
        canAssign={!task || task.permissions.assign || groupId !== task.groupId}
        onGroup={(g) => {
          setGroupId(g);
          // Assignees belong to one group: start again with "Me" when the group changes.
          setAssigneeId(g ? meId : null);
        }}
        onAssignee={setAssigneeId}
      />
      {fields.assigneeId && (
        <p className="field__error">
          <Icon name="alert" size={16} />
          {fields.assigneeId}
        </p>
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
  const search = useSearch({ strict: false }) as { group?: string };
  const back = () =>
    window.history.length > 1 ? window.history.back() : void navigate({ to: '/today' });
  return (
    <main id="main" className="page" style={{ paddingBlockEnd: 32 }}>
      <FormHeader title={t('task.new')} cancelTo={back} />
      <Link
        to="/tasks/voice"
        search={search.group ? { group: search.group } : {}}
        className="btn btn--secondary"
      >
        <Icon name="mic" size={18} />
        {t('voice.recordInstead')}
      </Link>
      <TaskForm
        initialGroup={search.group ?? null}
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
  const wide = useMediaQuery(WIDE_QUERY);
  // Desktop: back to the list with the task open in the side panel. Phones: back to the task page.
  const toDetail = () =>
    void (wide
      ? navigate({ to: '/tasks', search: { task: id }, replace: true })
      : navigate({ to: '/tasks/$id', params: { id }, replace: true }));
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
          key={task.data.id}
          task={task.data}
          onDone={(saved) => {
            if (saved && saved.version !== task.data.version) toast(t('task.saved'));
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

/** Voice task: record → check → title (pre-filled), list and person → save. */
export function VoiceTaskPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const online = useOnline();
  const me = useMe();
  const meId = me.data?.id ?? '';
  const tz = me.data?.timeZone ?? 'Asia/Kolkata';
  const search = useSearch({ strict: false }) as { group?: string };
  const create = useCreateTask();
  const [rec, setRec] = useState<Recording | null>(null);
  const [title, setTitle] = useState('');
  const [groupId, setGroupId] = useState<string | null>(search.group ?? null);
  const [assigneeId, setAssigneeId] = useState<string | null>(meId || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const back = () =>
    window.history.length > 1 ? window.history.back() : void navigate({ to: '/today' });

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!rec) return;
    setBusy(true);
    setError(null);
    try {
      const file = await uploadAudio(rec, 'task_audio');
      await create.mutateAsync({
        id: crypto.randomUUID(),
        title:
          title.trim() ||
          t('voice.defaultTitle', {
            when: formatDateTime(new Date().toISOString(), tz, intlLocale()),
          }),
        audioFileId: file.id,
        ...(groupId ? { groupId, assigneeId } : {}),
      });
      toast(t('task.created'));
      back();
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="main" className="page" style={{ paddingBlockEnd: 32 }}>
      <FormHeader title={t('voice.title')} cancelTo={back} />
      {!online ? (
        <p className="form-error" role="alert">
          {t('offline.voiceNeedsConnection')}
        </p>
      ) : !rec ? (
        <section className="card stack-lg" aria-label={t('voice.title')}>
          <p className="muted">{t('voice.intro')}</p>
          <Recorder
            useLabel={t('voice.useIt')}
            onUse={(r) => {
              setRec(r);
              setTitle(
                t('voice.defaultTitle', {
                  when: formatDateTime(new Date().toISOString(), tz, intlLocale()),
                }),
              );
            }}
          />
        </section>
      ) : (
        <form className="form" onSubmit={save} noValidate>
          <AudioPlayer
            src={URL.createObjectURL(rec.blob)}
            label={t('voice.yourRecording', { duration: formatDuration(rec.durationMs) })}
          />
          <button
            type="button"
            className="btn btn--ghost btn--small"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => setRec(null)}
          >
            <Icon name="mic" size={18} />
            {t('voice.again')}
          </button>
          <TextField
            label={t('task.fields.title')}
            hint={t('voice.titleHint')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={LIMITS.taskTitle}
          />
          <WhereAndWho
            groupId={groupId}
            assigneeId={assigneeId}
            meId={meId}
            canMove
            canAssign
            onGroup={(g) => {
              setGroupId(g);
              setAssigneeId(g ? meId : null);
            }}
            onAssignee={setAssigneeId}
          />
          <FormError message={error} />
          <div className="sticky-actions">
            <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
              {busy && <Spinner />}
              {t('voice.save')}
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
