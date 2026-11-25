import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { LinkedText } from './LinkedText';
import { useTranslation } from 'react-i18next';
import { LIMITS, type CommentDto, type TaskDto } from '@todo/shared';
import { useOnline, usePendingSync } from '../api/offline';
import {
  useAddComment,
  useAddVoiceComment,
  useComments,
  useDeleteComment,
  useEditComment,
} from '../api/queries';
import { AudioPlayer, Recorder, formatDuration } from './Recorder';
import { errorMessage } from '../lib/errors';
import { formatDateTime } from '../lib/format';
import { intlLocale } from '../lib/i18n';
import { Dialog } from './Dialog';
import { MiniAvatar } from './GroupBits';
import { Icon } from './Icon';
import { ReportDialog } from './ReportDialog';
import { ErrorState, LoadingList, Spinner } from './States';
import { useToast } from './Toasts';

function CommentItem({
  c,
  task,
  meId,
  tz,
  onReport,
  onDelete,
  pending,
}: {
  pending: boolean;
  c: CommentDto;
  task: TaskDto;
  meId: string;
  tz: string;
  onReport: (c: CommentDto) => void;
  onDelete: (c: CommentDto) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const edit = useEditComment(task.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.body ?? '');
  const name = c.author
    ? c.author.id === meId
      ? t('task.activity.you')
      : c.author.name
    : t('task.comments.deletedUser');

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    try {
      await edit.mutateAsync({ id: c.id, body: draft });
      setEditing(false);
    } catch (err) {
      toast(errorMessage(err, t), { tone: 'error' });
    }
  }

  return (
    <li className="comment">
      <MiniAvatar person={c.author ?? { name: '?', avatarUrl: null }} size={32} />
      <div className="comment__body">
        <div className="comment__head">
          <span className="comment__author">{name}</span>
          <time className="meta" dateTime={c.createdAt}>
            {formatDateTime(c.createdAt, tz, intlLocale())}
          </time>
          {c.editedAt && <span className="meta">· {t('task.comments.edited')}</span>}
        </div>
        {editing ? (
          <form className="stack" onSubmit={save}>
            <label htmlFor={`edit-${c.id}`} className="visually-hidden">
              {t('task.comments.editLabel')}
            </label>
            <textarea
              id={`edit-${c.id}`}
              className="input"
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={LIMITS.comment}
              autoFocus
            />
            <div className="row">
              <button
                type="submit"
                className="btn btn--primary btn--small"
                disabled={edit.isPending}
              >
                {edit.isPending && <Spinner />}
                {t('common.save')}
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={() => {
                  setEditing(false);
                  setDraft(c.body ?? '');
                }}
              >
                {t('common.cancel')}
              </button>
            </div>
          </form>
        ) : c.removed ? (
          <p className="comment__text comment__text--removed">{t('task.comments.removed')}</p>
        ) : (
          <>
            {c.body && (
              <p className="comment__text">
                <LinkedText text={c.body} />
              </p>
            )}
            {c.audio && (
              <AudioPlayer
                src={c.audio.url}
                label={t('voice.replyFrom', {
                  name,
                  duration: c.audio.durationMs ? formatDuration(c.audio.durationMs) : '',
                })}
              />
            )}
            {pending && (
              <span className="meta task-meta__sync">
                <Icon name="sync" size={14} /> {t('offline.waiting')}
              </span>
            )}
          </>
        )}
        {!editing && (c.permissions.edit || c.permissions.delete || c.permissions.report) && (
          <div className="comment__actions">
            {c.permissions.edit && (
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={() => setEditing(true)}
              >
                {t('common.edit')}
                <span className="visually-hidden"> {t('task.comments.yourComment')}</span>
              </button>
            )}
            {c.permissions.delete && (
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={() => onDelete(c)}
              >
                {t('common.delete')}
                <span className="visually-hidden"> {t('task.comments.yourComment')}</span>
              </button>
            )}
            {c.permissions.report && (
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={() => onReport(c)}
              >
                <Icon name="flag" size={16} />
                {t('task.comments.report')}
                <span className="visually-hidden"> ({name})</span>
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

/** Comment thread (oldest first) with a composer at the bottom. */
export function Comments({ task, meId, tz }: { task: TaskDto; meId: string; tz: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const list = useComments(task.id);
  const add = useAddComment(task.id);
  const remove = useDeleteComment(task.id);
  const [body, setBody] = useState('');
  const [recording, setRecording] = useState(false);
  const pendingSync = usePendingSync();
  const online = useOnline();
  const voice = useAddVoiceComment(task.id);
  const [reporting, setReporting] = useState<CommentDto | null>(null);
  const [deleting, setDeleting] = useState<CommentDto | null>(null);
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const headingId = `comments-${task.id}`;

  async function send(e?: FormEvent) {
    e?.preventDefault();
    if (!body.trim()) return;
    // Shows at once; offline it waits ("waiting to sync") and is sent when back online.
    add.mutate(
      { taskId: task.id, id: crypto.randomUUID(), body: body.trim() },
      { onError: (err) => toast(errorMessage(err, t), { tone: 'error' }) },
    );
    setBody('');
  }

  // Ctrl/⌘ + Enter sends; Enter alone makes a new line (comments can be several lines).
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void send();
  };

  return (
    <section className="stack" aria-labelledby={headingId}>
      <h3 id={headingId} className="section-title">
        {t('task.comments.title')}
        {task.commentCount > 0 && <span className="meta"> ({task.commentCount})</span>}
      </h3>
      {list.isPending ? (
        <LoadingList rows={2} />
      ) : list.isError ? (
        <ErrorState message={errorMessage(list.error, t)} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <p className="muted">{t('task.comments.empty')}</p>
      ) : (
        <ol className="comments" aria-live="polite">
          {items.map((c) => (
            <CommentItem
              key={c.id}
              c={c}
              task={task}
              meId={meId}
              tz={tz}
              onReport={setReporting}
              onDelete={setDeleting}
              pending={pendingSync.comments.has(c.id)}
            />
          ))}
        </ol>
      )}
      {list.hasNextPage && (
        <button
          type="button"
          className="btn btn--secondary btn--small"
          onClick={() => void list.fetchNextPage()}
          disabled={list.isFetchingNextPage}
        >
          {list.isFetchingNextPage && <Spinner />}
          {t('tasks.loadMore')}
        </button>
      )}
      {task.permissions.comment && (
        <form className="composer" onSubmit={send}>
          <label htmlFor={`composer-${task.id}`} className="visually-hidden">
            {t('task.comments.label')}
          </label>
          <textarea
            id={`composer-${task.id}`}
            className="input"
            rows={1}
            placeholder={t('task.comments.placeholder')}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={onKey}
            maxLength={LIMITS.comment}
          />
          {body.trim() ? (
            <button type="submit" className="btn btn--primary">
              <Icon name="send" size={18} />
              {t('task.comments.send')}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--secondary"
              disabled={!online}
              title={online ? undefined : t('offline.voiceNeedsConnection')}
              onClick={() => setRecording(true)}
            >
              <Icon name="mic" size={18} />
              {t('voice.reply')}
            </button>
          )}
        </form>
      )}
      <Dialog open={recording} onClose={() => setRecording(false)} title={t('voice.replyTitle')}>
        {recording && (
          <Recorder
            useLabel={t('voice.sendReply')}
            busy={voice.isPending}
            onUse={(rec) =>
              voice.mutate(rec, {
                onSuccess: () => {
                  setRecording(false);
                  toast(t('voice.replySent'));
                },
                onError: (err) => toast(errorMessage(err, t), { tone: 'error' }),
              })
            }
          />
        )}
      </Dialog>
      <Dialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={t('task.comments.deleteTitle')}
        role="alertdialog"
      >
        <div className="modal__actions">
          <button
            type="button"
            className="btn btn--danger btn--block"
            disabled={remove.isPending}
            onClick={async () => {
              if (!deleting) return;
              try {
                await remove.mutateAsync(deleting.id);
                toast(t('task.comments.deleted'));
                setDeleting(null);
              } catch (err) {
                toast(errorMessage(err, t), { tone: 'error' });
              }
            }}
          >
            {remove.isPending && <Spinner />}
            {t('common.delete')}
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--block"
            onClick={() => setDeleting(null)}
          >
            {t('common.cancel')}
          </button>
        </div>
      </Dialog>
      {reporting && (
        <ReportDialog
          open
          onClose={() => setReporting(null)}
          target={{ type: 'comment', id: reporting.id }}
        />
      )}
    </section>
  );
}
