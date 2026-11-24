import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AdminReportDto } from '@todo/shared';
import {
  useAdminReport,
  useAdminReports,
  useIsOwner,
  useMe,
  useResolveReport,
  useSuspendUser,
} from '../api/queries';
import { FormError } from '../components/Field';
import { NotFoundPage } from './misc';
import { EmptyState, ErrorState, LoadingList, Spinner } from '../components/States';
import { useToast } from '../components/Toasts';
import { errorMessage } from '../lib/errors';
import { formatDateTime } from '../lib/format';
import { intlLocale } from '../lib/i18n';

type Status = 'open' | 'actioned' | 'dismissed';

/** Shows a snapshot/current record as label: value lines (plain text, never HTML). */
function Record({ data }: { data: Record<string, unknown> | null }) {
  const { t } = useTranslation();
  if (!data) return <p className="muted">{t('admin.purged')}</p>;
  const lines = Object.entries(data)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  return <pre className="evidence">{lines.join('\n')}</pre>;
}

function Detail({ id, tz, onClosed }: { id: string; tz: string; onClosed: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const report = useAdminReport(id);
  const resolve = useResolveReport();
  const suspend = useSuspendUser();
  const [note, setNote] = useState('');
  const [alsoSuspend, setAlsoSuspend] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (report.isPending) return <LoadingList rows={4} />;
  if (report.isError) return <ErrorState message={errorMessage(report.error, t)} />;
  const r = report.data;
  const open = r.status === 'open';

  async function act(action: 'remove' | 'dismiss') {
    setError(null);
    try {
      await resolve.mutateAsync({
        id,
        action,
        suspendOwner: action === 'remove' && alsoSuspend,
        note: note || undefined,
      });
      toast(t('admin.closed'));
      onClosed();
    } catch (err) {
      setError(errorMessage(err, t));
    }
  }

  return (
    <article className="card stack-lg" aria-labelledby="report-title">
      <header className="stack" style={{ gap: 4 }}>
        <h2 id="report-title" className="section-title">
          {t(`admin.targets.${r.targetType}`)} · {t(`report.reasons.${r.reason}`)}
        </h2>
        <p className="meta">
          {t('admin.reportedBy', { name: r.reporter?.name ?? '—' })} ·{' '}
          {formatDateTime(r.createdAt, tz, intlLocale())}
          {r.group && ` · ${r.group.icon ?? ''} ${r.group.name}`}
        </p>
        {r.sameTargetOpen > 1 && (
          <p className="meta" style={{ color: 'var(--color-alert)', fontWeight: 600 }}>
            {t('admin.sameTarget', { count: r.sameTargetOpen })}
          </p>
        )}
      </header>
      {r.details && (
        <section className="stack">
          <h3 className="field__label">{t('admin.details')}</h3>
          <p className="evidence">{r.details}</p>
        </section>
      )}
      <section className="stack">
        <h3 className="field__label">{t('admin.snapshot')}</h3>
        <Record data={r.snapshot} />
      </section>
      <section className="stack">
        <h3 className="field__label">{t('admin.current')}</h3>
        <Record data={r.current} />
      </section>
      {r.context.length > 0 && (
        <section className="stack">
          <h3 className="field__label">{t('admin.context')}</h3>
          <ol className="activity">
            {r.context.map((c, i) => (
              <li key={i}>
                <span>
                  <strong>{c.label}:</strong> {c.text}
                </span>
                <time className="meta" dateTime={c.at}>
                  {formatDateTime(c.at, tz, intlLocale())}
                </time>
              </li>
            ))}
          </ol>
        </section>
      )}
      {r.owner && (
        <section className="row" style={{ justifyContent: 'space-between' }}>
          <span>
            <span className="field__label">{t('admin.owner')}: </span>
            {r.owner.name}
            {r.owner.suspended && <span className="badge-ok"> {t('admin.suspended')}</span>}
          </span>
          {r.owner.suspended && (
            <button
              type="button"
              className="btn btn--ghost btn--small"
              disabled={suspend.isPending}
              onClick={() =>
                suspend.mutate(
                  { userId: r.owner!.id, suspend: false },
                  { onSuccess: () => toast(t('admin.unsuspended')) },
                )
              }
            >
              {t('admin.unsuspend')}
            </button>
          )}
        </section>
      )}
      {open ? (
        <section className="stack">
          <label className="field__label" htmlFor="resolve-note">
            {t('admin.note')}
          </label>
          <textarea
            id="resolve-note"
            className="input"
            rows={2}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {r.owner && r.targetType !== 'user' && !r.owner.suspended && (
            <label className="check">
              <input
                type="checkbox"
                checked={alsoSuspend}
                onChange={(e) => setAlsoSuspend(e.target.checked)}
              />
              <span>{t('admin.alsoSuspend', { name: r.owner.name })}</span>
            </label>
          )}
          <FormError message={error} />
          <div className="row">
            <button
              type="button"
              className="btn btn--danger"
              disabled={resolve.isPending}
              onClick={() => void act('remove')}
            >
              {resolve.isPending && <Spinner />}
              {r.targetType === 'user' ? t('admin.suspendUser') : t('admin.remove')}
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={resolve.isPending}
              onClick={() => void act('dismiss')}
            >
              {t('admin.dismiss')}
            </button>
          </div>
        </section>
      ) : (
        <p className="meta">
          {t(`admin.status.${r.status}`)}
          {r.resolvedAt && ` · ${formatDateTime(r.resolvedAt, tz, intlLocale())}`}
        </p>
      )}
    </article>
  );
}

/** Owner-only review page. It isn't linked anywhere; everyone else sees "page not found". */
export function AdminPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { status?: string; report?: string };
  const owner = useIsOwner();
  const me = useMe();
  const tz = me.data?.timeZone ?? 'Asia/Kolkata';
  const status: Status =
    search.status === 'actioned' || search.status === 'dismissed' ? search.status : 'open';
  const list = useAdminReports(status, owner.isSuccess);

  if (owner.isPending) return <LoadingList rows={3} />;
  if (owner.isError) return <NotFoundPage />;

  const go = (s: { status?: Status; report?: string }) =>
    void navigate({
      to: '/admin',
      search: { status: s.status === 'open' ? undefined : s.status, report: s.report },
    });

  return (
    <main id="main" className="page" style={{ maxInlineSize: 1100 }}>
      <h1 className="screen-title">{t('admin.title')}</h1>
      <nav aria-label={t('admin.tabs')} className="tabs">
        {(['open', 'actioned', 'dismissed'] as const).map((s) => (
          <Link
            key={s}
            to="/admin"
            search={{ status: s === 'open' ? undefined : s }}
            className="tab"
            aria-current={status === s ? 'page' : undefined}
          >
            {t(`admin.status.${s}`)}
          </Link>
        ))}
      </nav>
      <div className="admin-grid">
        <section aria-label={t('admin.list')}>
          {list.isPending ? (
            <LoadingList rows={4} />
          ) : list.isError ? (
            <ErrorState message={errorMessage(list.error, t)} onRetry={() => void list.refetch()} />
          ) : list.data.items.length === 0 ? (
            <EmptyState icon="shield" title={t('admin.empty')} />
          ) : (
            <ul className="list-card" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {list.data.items.map((r: AdminReportDto) => (
                <li key={r.id}>
                  <Link
                    to="/admin"
                    search={{ status: status === 'open' ? undefined : status, report: r.id }}
                    className="report-row"
                    aria-current={search.report === r.id ? 'true' : undefined}
                  >
                    <span style={{ fontWeight: 600 }}>
                      {t(`admin.targets.${r.targetType}`)} · {t(`report.reasons.${r.reason}`)}
                    </span>
                    <span className="meta">
                      {formatDateTime(r.createdAt, tz, intlLocale())}
                      {r.sameTargetOpen > 1 &&
                        ` · ${t('admin.sameTarget', { count: r.sameTargetOpen })}`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-live="polite">
          {search.report ? (
            <Detail
              key={search.report}
              id={search.report}
              tz={tz}
              onClosed={() => go({ status })}
            />
          ) : (
            <p className="muted">{t('admin.pick')}</p>
          )}
        </section>
      </div>
    </main>
  );
}
