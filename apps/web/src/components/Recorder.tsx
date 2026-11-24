import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AUDIO } from '@todo/shared';
import type { Recording } from '../api/queries';
import { Icon } from './Icon';

type State =
  | { kind: 'idle' }
  | { kind: 'asking' }
  | { kind: 'denied' }
  | { kind: 'unsupported' }
  | { kind: 'error' }
  | { kind: 'recording'; startedAt: number }
  | { kind: 'recorded'; rec: Recording; url: string };

/** Best format this browser can record: WebM/Opus (Chrome, Android, Firefox) or MP4 (Safari). */
function pickMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'])
    if (MediaRecorder.isTypeSupported(m)) return m;
  return undefined;
}

export const formatDuration = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Record → listen → re-record or use it. Stops by itself at 2 minutes.
 * `big` is the Simple mode look: one huge button at a time.
 */
export function Recorder({
  onUse,
  useLabel,
  busy = false,
  big = false,
  autoStart = false,
}: {
  onUse: (rec: Recording) => void;
  useLabel: string;
  busy?: boolean;
  big?: boolean;
  autoStart?: boolean;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [now, setNow] = useState(0);
  const media = useRef<{ rec: MediaRecorder; stream: MediaStream } | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number | undefined>(undefined);
  const stopRef = useRef<() => void>(() => undefined);
  const live = useRef<HTMLParagraphElement>(null);

  function cleanup() {
    window.clearInterval(timer.current);
    media.current?.stream.getTracks().forEach((tr) => tr.stop());
    media.current = null;
  }

  useEffect(
    () => () => {
      cleanup();
      if (state.kind === 'recorded') URL.revokeObjectURL(state.url);
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  async function start() {
    const mime = pickMime();
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setState({ kind: 'unsupported' });
      return;
    }
    setState({ kind: 'asking' });
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = (err as DOMException).name;
      setState({
        kind: name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'error',
      });
      return;
    }
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunks.current = [];
    const startedAt = Date.now();
    rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    rec.onstop = () => {
      const durationMs = Math.min(Date.now() - startedAt, AUDIO.maxMs);
      const type = (rec.mimeType || mime || 'audio/webm').split(';')[0]!;
      const blob = new Blob(chunks.current, { type });
      cleanup();
      setState({
        kind: 'recorded',
        rec: { blob, mimeType: type, durationMs },
        url: URL.createObjectURL(blob),
      });
    };
    media.current = { rec, stream };
    rec.start(1000);
    setState({ kind: 'recording', startedAt });
    stopRef.current = () => rec.state !== 'inactive' && rec.stop();
    timer.current = window.setInterval(() => {
      setNow(Date.now());
      if (Date.now() - startedAt >= AUDIO.maxMs) stopRef.current();
    }, 250);
  }

  useEffect(() => {
    if (!autoStart) return;
    const id = window.setTimeout(() => void start(), 0);
    return () => window.clearTimeout(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function again() {
    if (state.kind === 'recorded') URL.revokeObjectURL(state.url);
    void start();
  }

  const btn = big ? 'btn btn--primary btn--huge' : 'btn btn--primary';
  const btn2 = big ? 'btn btn--secondary btn--big' : 'btn btn--secondary';

  if (state.kind === 'recording') {
    const elapsed = now - state.startedAt;
    const left = AUDIO.maxMs - elapsed;
    return (
      <div className={`recorder recorder--live${big ? ' recorder--big' : ''}`}>
        <p className="recorder__time" aria-hidden="true">
          <span className="recorder__dot" /> {formatDuration(elapsed)}
        </p>
        <p className="meta" ref={live} role="status">
          {left <= 15_000
            ? t('voice.endsSoon', { seconds: Math.ceil(left / 1000) })
            : t('voice.recording')}
        </p>
        <button type="button" className={btn} onClick={() => stopRef.current()} autoFocus>
          <Icon name="stop" size={big ? 32 : 20} />
          {t('voice.stop')}
        </button>
      </div>
    );
  }

  if (state.kind === 'recorded') {
    return (
      <div className={`recorder${big ? ' recorder--big' : ''}`}>
        <AudioPlayer
          src={state.url}
          label={t('voice.yourRecording', { duration: formatDuration(state.rec.durationMs) })}
          big={big}
        />
        <div className={big ? 'stack' : 'row'}>
          <button
            type="button"
            className={btn}
            disabled={busy}
            onClick={() => onUse(state.rec)}
            autoFocus
          >
            <Icon name="send" size={big ? 28 : 18} />
            {useLabel}
          </button>
          <button type="button" className={btn2} disabled={busy} onClick={again}>
            <Icon name="mic" size={big ? 28 : 18} />
            {t('voice.again')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`recorder${big ? ' recorder--big' : ''}`}>
      {state.kind === 'denied' && (
        <div className="form-error" role="alert">
          <strong>{t('voice.denied.title')}</strong>
          <span>{t('voice.denied.body')}</span>
        </div>
      )}
      {state.kind === 'unsupported' && (
        <p className="form-error" role="alert">
          {t('voice.unsupported')}
        </p>
      )}
      {state.kind === 'error' && (
        <p className="form-error" role="alert">
          {t('voice.noMic')}
        </p>
      )}
      <button
        type="button"
        className={btn}
        onClick={() => void start()}
        disabled={state.kind === 'asking' || state.kind === 'unsupported'}
      >
        <Icon name="mic" size={big ? 32 : 20} />
        {state.kind === 'asking' ? t('voice.asking') : t('voice.start')}
      </button>
      {!big && <p className="field__hint">{t('voice.hint')}</p>}
    </div>
  );
}

/** Native player: keyboard and screen-reader friendly, with a clear label. */
export function AudioPlayer({
  src,
  label,
  big = false,
}: {
  src: string;
  label: string;
  big?: boolean;
}) {
  return (
    <figure className={`audio${big ? ' audio--big' : ''}`}>
      <figcaption className="meta">{label}</figcaption>
      {/* No captions yet: speech-to-text was left out of the MVP (decision of 18 Nov). The
          transcript column is ready; when it's filled, it goes here as a <track>/text. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio controls preload="metadata" src={src} aria-label={label} />
    </figure>
  );
}
