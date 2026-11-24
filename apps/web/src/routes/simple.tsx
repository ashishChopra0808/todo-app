import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { SimpleItemDto } from '@todo/shared';
import { useOnline } from '../api/offline';
import {
  useMarkHeard,
  useMe,
  useSendVoiceMessage,
  useSendVoiceReply,
  useSimpleHome,
  useSimplePerson,
  useTask,
  useToggleStatus,
} from '../api/queries';
import { MiniAvatar } from '../components/GroupBits';
import { Icon } from '../components/Icon';
import { AudioPlayer, Recorder, formatDuration } from '../components/Recorder';
import { ErrorState, LoadingList } from '../components/States';
import { useToast } from '../components/Toasts';
import { errorMessage } from '../lib/errors';
import { formatDateTime } from '../lib/format';
import { intlLocale } from '../lib/i18n';

/** Reads the screen aloud with the phone's own voice (free, works offline on most phones). */
function HearButton({ text }: { text: string }) {
  const { t, i18n } = useTranslation();
  const [speaking, setSpeaking] = useState(false);
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  return (
    <button
      type="button"
      className="btn btn--secondary simple__hear"
      aria-pressed={speaking}
      onClick={() => {
        const synth = window.speechSynthesis;
        if (speaking) {
          synth.cancel();
          setSpeaking(false);
          return;
        }
        const u = new SpeechSynthesisUtterance(text);
        u.lang = i18n.language === 'hi' ? 'hi-IN' : 'en-IN';
        u.rate = 0.9;
        u.onend = () => setSpeaking(false);
        u.onerror = () => setSpeaking(false);
        synth.cancel();
        synth.speak(u);
        setSpeaking(true);
      }}
    >
      <Icon name="volume" size={26} />
      {speaking ? t('simple.stopHear') : t('simple.hear')}
    </button>
  );
}

function SimpleFrame({
  title,
  hear,
  back,
  children,
}: {
  title: string;
  hear: string;
  back?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const online = useOnline();
  useEffect(() => () => window.speechSynthesis?.cancel(), []);
  return (
    <main id="main" className="simple">
      <header className="simple__head">
        {back && (
          <Link to="/simple" className="btn btn--secondary simple__back">
            <Icon name="chevronLeft" size={28} />
            {t('simple.home')}
          </Link>
        )}
        <h1 className="simple__title">{title}</h1>
        <HearButton text={`${title}. ${hear}`} />
      </header>
      {!online && (
        <p className="simple__offline" role="status">
          <Icon name="wifiOff" size={24} />
          {t('simple.offline')}
        </p>
      )}
      {children}
    </main>
  );
}

function Sent({ name, onHome }: { name: string; onHome: () => void }) {
  const { t } = useTranslation();
  return (
    <section className="simple__sent" role="status" aria-live="polite">
      <span className="simple__sent-icon" aria-hidden="true">
        <Icon name="check" size={56} />
      </span>
      <p className="simple__big-text">{t('simple.sentTo', { name })}</p>
      <button type="button" className="btn btn--primary btn--huge" onClick={onHome} autoFocus>
        <Icon name="chevronLeft" size={32} />
        {t('simple.home')}
      </button>
    </section>
  );
}

function ItemCard({ item, tz }: { item: SimpleItemDto; tz: string }) {
  const { t } = useTranslation();
  const who = item.fromMe ? t('simple.you') : (item.from?.name ?? t('notify.someone'));
  return (
    <article className={`simple__msg${item.fromMe ? ' simple__msg--me' : ''}`}>
      <p className="simple__msg-head">
        <strong>{who}</strong>
        {item.unread && <span className="simple__new">{t('simple.new')}</span>}
        <time className="simple__meta" dateTime={item.createdAt}>
          {formatDateTime(item.createdAt, tz, intlLocale())}
        </time>
      </p>
      {item.audio ? (
        <AudioPlayer
          big
          src={item.audio.url}
          label={t('simple.messageFrom', {
            name: who,
            duration: item.audio.durationMs ? formatDuration(item.audio.durationMs) : '',
          })}
        />
      ) : null}
      {item.kind === 'task' && item.title && <p className="simple__msg-text">{item.title}</p>}
      {item.kind === 'reply' && item.text && <p className="simple__msg-text">{item.text}</p>}
      {item.kind === 'task' && item.status === 'done' && (
        <p className="simple__done">
          <Icon name="check" size={22} /> {t('simple.done')}
        </p>
      )}
      {item.forMe && (
        <Link
          to="/simple/task/$id"
          params={{ id: item.taskId }}
          className="btn btn--primary btn--big"
        >
          <Icon name="check" size={28} />
          {t('simple.answer')}
        </Link>
      )}
    </article>
  );
}

export function SimpleHomePage() {
  const { t } = useTranslation();
  const me = useMe();
  const tz = me.data?.timeZone ?? 'Asia/Kolkata';
  const home = useSimpleHome();
  const first = (me.data?.name ?? '').split(' ')[0] ?? '';
  const d = home.data;
  const hear = d
    ? [
        d.newest
          ? t('simple.hearNewest', { name: d.newest.from?.name ?? t('notify.someone') })
          : t('simple.noNew'),
        d.taskForMe ? t('simple.hearTask', { task: d.taskForMe.title ?? '' }) : '',
        d.people.length
          ? t('simple.hearPeople', { names: d.people.map((p) => p.name).join(', ') })
          : '',
      ]
        .filter(Boolean)
        .join('. ')
    : '';

  return (
    <SimpleFrame title={t('simple.hello', { name: first })} hear={hear}>
      {home.isPending ? (
        <LoadingList rows={3} />
      ) : home.isError ? (
        <ErrorState message={errorMessage(home.error, t)} onRetry={() => void home.refetch()} />
      ) : (
        <>
          {d!.newest && (
            <section className="simple__card simple__card--new" aria-labelledby="s-new">
              <h2 id="s-new" className="simple__card-title">
                {t('simple.newMessage', { name: d!.newest.from?.name ?? t('notify.someone') })}
              </h2>
              <ItemCard item={d!.newest} tz={tz} />
              {d!.newest.from && (
                <Link
                  to="/simple/person/$id"
                  params={{ id: d!.newest.from.id }}
                  className="btn btn--secondary btn--big"
                >
                  <Icon name="message" size={28} />
                  {t('simple.openWith', { name: d!.newest.from.name })}
                </Link>
              )}
            </section>
          )}
          {d!.taskForMe && d!.taskForMe.taskId !== d!.newest?.taskId && (
            <section className="simple__card" aria-labelledby="s-task">
              <h2 id="s-task" className="simple__card-title">
                {t('simple.taskForYou')}
              </h2>
              <ItemCard item={d!.taskForMe} tz={tz} />
            </section>
          )}
          <section aria-labelledby="s-people">
            <h2 id="s-people" className="simple__card-title">
              {t('simple.people')}
            </h2>
            {d!.people.length === 0 ? (
              <p className="simple__big-text">{t('simple.noPeople')}</p>
            ) : (
              <ul className="simple__people">
                {d!.people.map((p) => (
                  <li key={p.id}>
                    <Link to="/simple/person/$id" params={{ id: p.id }} className="simple__person">
                      <MiniAvatar person={p} size={72} />
                      <span className="simple__person-name">{p.name}</span>
                      {p.unread > 0 && (
                        <span className="simple__badge">
                          {t('simple.unread', { count: p.unread })}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <Link to="/settings" className="simple__exit">
            {t('simple.fullApp')}
          </Link>
        </>
      )}
    </SimpleFrame>
  );
}

export function SimplePersonPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const online = useOnline();
  const { id } = useParams({ strict: false }) as { id: string };
  const me = useMe();
  const tz = me.data?.timeZone ?? 'Asia/Kolkata';
  const conv = useSimplePerson(id);
  const heard = useMarkHeard();
  const send = useSendVoiceMessage();
  const [mode, setMode] = useState<'list' | 'record' | 'sent'>('list');
  const person = conv.data?.person;

  useEffect(() => {
    if (conv.data && conv.data.person.unread > 0) heard.mutate(id);
  }, [conv.data?.person.unread]); // eslint-disable-line react-hooks/exhaustive-deps

  const name = person?.name ?? '';
  if (mode === 'sent')
    return (
      <SimpleFrame title={name} hear={t('simple.sentTo', { name })} back>
        <Sent name={name} onHome={() => void navigate({ to: '/simple' })} />
      </SimpleFrame>
    );

  return (
    <SimpleFrame
      title={name}
      back
      hear={conv.data ? t('simple.hearConversation', { count: conv.data.items.length, name }) : ''}
    >
      {conv.isPending ? (
        <LoadingList rows={3} />
      ) : conv.isError ? (
        <ErrorState message={errorMessage(conv.error, t)} />
      ) : mode === 'record' ? (
        <section className="simple__card" aria-label={t('simple.speakTo', { name })}>
          <Recorder
            big
            autoStart
            useLabel={t('simple.send')}
            busy={send.isPending}
            onUse={(rec) =>
              send.mutate(
                {
                  rec,
                  to: id,
                  groupId: person!.groupId,
                  title: t('simple.messageTitle', {
                    when: formatDateTime(new Date().toISOString(), tz, intlLocale()),
                  }),
                },
                {
                  onSuccess: () => setMode('sent'),
                  onError: (err) => toast(errorMessage(err, t), { tone: 'error' }),
                },
              )
            }
          />
          <button
            type="button"
            className="btn btn--secondary btn--big"
            onClick={() => setMode('list')}
          >
            <Icon name="x" size={28} />
            {t('common.cancel')}
          </button>
        </section>
      ) : (
        <>
          {conv.data.items.length === 0 ? (
            <p className="simple__big-text">{t('simple.noMessages', { name })}</p>
          ) : (
            <ol className="simple__list">
              {conv.data.items.slice(-10).map((item) => (
                <li key={`${item.kind}-${item.id}`}>
                  <ItemCard item={item} tz={tz} />
                </li>
              ))}
            </ol>
          )}
          <button
            type="button"
            className="btn btn--primary btn--huge simple__speak"
            disabled={!online}
            onClick={() => setMode('record')}
          >
            <Icon name="mic" size={36} />
            {t('simple.speakTo', { name })}
          </button>
        </>
      )}
    </SimpleFrame>
  );
}

/** "Task for you": listen, then "Yes, done" or reply by voice. */
export function SimpleTaskPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const online = useOnline();
  const { id } = useParams({ strict: false }) as { id: string };
  const task = useTask(id);
  const toggle = useToggleStatus();
  const reply = useSendVoiceReply();
  const [mode, setMode] = useState<'view' | 'record' | 'sent' | 'done'>('view');
  const from = task.data?.createdBy?.name ?? '';
  const home = () => void navigate({ to: '/simple' });

  if (mode === 'sent')
    return (
      <SimpleFrame title={t('simple.taskForYou')} hear={t('simple.sentTo', { name: from })} back>
        <Sent name={from} onHome={home} />
      </SimpleFrame>
    );
  if (mode === 'done')
    return (
      <SimpleFrame title={t('simple.taskForYou')} hear={t('simple.markedDone')} back>
        <section className="simple__sent" role="status">
          <span className="simple__sent-icon" aria-hidden="true">
            <Icon name="check" size={56} />
          </span>
          <p className="simple__big-text">{t('simple.markedDone')}</p>
          <button type="button" className="btn btn--primary btn--huge" onClick={home} autoFocus>
            <Icon name="chevronLeft" size={32} />
            {t('simple.home')}
          </button>
        </section>
      </SimpleFrame>
    );

  return (
    <SimpleFrame
      title={t('simple.taskForYou')}
      back
      hear={task.data ? t('simple.hearTaskFrom', { name: from, task: task.data.title }) : ''}
    >
      {task.isPending ? (
        <LoadingList rows={2} />
      ) : task.isError ? (
        <ErrorState message={errorMessage(task.error, t)} />
      ) : (
        <section className="simple__card">
          <p className="simple__meta">{t('simple.from', { name: from })}</p>
          {task.data.audio && (
            <AudioPlayer
              big
              src={task.data.audio.url}
              label={t('simple.messageFrom', { name: from, duration: '' })}
            />
          )}
          <p className="simple__big-text">{task.data.title}</p>
          {mode === 'record' ? (
            <>
              <Recorder
                big
                autoStart
                useLabel={t('simple.send')}
                busy={reply.isPending}
                onUse={(rec) =>
                  reply.mutate(
                    { rec, taskId: id, personId: task.data.createdBy?.id ?? '' },
                    {
                      onSuccess: () => setMode('sent'),
                      onError: (err) => toast(errorMessage(err, t), { tone: 'error' }),
                    },
                  )
                }
              />
              <button
                type="button"
                className="btn btn--secondary btn--big"
                onClick={() => setMode('view')}
              >
                <Icon name="x" size={28} />
                {t('common.cancel')}
              </button>
            </>
          ) : (
            <>
              {task.data.status !== 'done' && task.data.permissions.changeStatus && (
                <button
                  type="button"
                  className="btn btn--primary btn--huge"
                  onClick={() => {
                    toggle.mutate(
                      task.data,
                      { onError: (err) => toast(errorMessage(err, t), { tone: 'error' }) },
                      'done',
                    );
                    setMode('done');
                  }}
                >
                  <Icon name="check" size={36} />
                  {t('simple.yesDone')}
                </button>
              )}
              <button
                type="button"
                className="btn btn--secondary btn--big"
                disabled={!online}
                onClick={() => setMode('record')}
              >
                <Icon name="mic" size={28} />
                {t('simple.reply')}
              </button>
            </>
          )}
        </section>
      )}
    </SimpleFrame>
  );
}
