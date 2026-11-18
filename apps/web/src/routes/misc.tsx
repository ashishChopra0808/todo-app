import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { patch } from '../api/client';
import { keys } from '../api/queries';
import { Icon } from '../components/Icon';
import { LanguageSelect } from '../components/LanguageSelect';
import { Spinner } from '../components/States';
import { browserTimeZone } from '../lib/auth-api';
import { currentLocale } from '../lib/i18n';

const SECTIONS = ['s1', 's2', 's3', 's4', 's5', 's6'];

export function LegalPage() {
  const { t } = useTranslation();
  const { page } = useParams({ strict: false }) as { page: 'terms' | 'privacy' | 'grievance' };
  const known = ['terms', 'privacy', 'grievance'].includes(page);
  if (!known) return <NotFoundPage />;
  return (
    <main id="main" className="page legal">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button
          type="button"
          className="btn btn--ghost btn--small"
          style={{ paddingInline: 4 }}
          onClick={() => window.history.back()}
        >
          <Icon name="chevronLeft" size={20} />
          {t('common.back')}
        </button>
        <LanguageSelect />
      </div>
      <h1 className="screen-title">{t(`legal.${page}.title`)}</h1>
      <p className="draft-banner" role="note">
        {t('legal.draft')}
      </p>
      <p>{t(`legal.${page}.intro`)}</p>
      {page === 'grievance' ? (
        <>
          <dl className="detail-meta card">
            <dt>{t('legal.grievance.officer')}</dt>
            <dd>{t('legal.grievance.officerValue')}</dd>
            <dt>{t('legal.grievance.email')}</dt>
            <dd>{t('legal.grievance.emailValue')}</dd>
          </dl>
          <p>{t('legal.grievance.timelines')}</p>
          <p className="muted">{t('legal.grievance.include')}</p>
        </>
      ) : (
        SECTIONS.map((s) => (
          <section key={s}>
            <h2>{t(`legal.${page}.${s}h`)}</h2>
            <p>{t(`legal.${page}.${s}`)}</p>
          </section>
        ))
      )}
    </main>
  );
}

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <main id="main" className="center-screen">
      <h1 className="screen-title">{t('pages.notFound.title')}</h1>
      <p className="muted">{t('pages.notFound.body')}</p>
      <Link to="/today" className="btn btn--primary">
        {t('pages.notFound.home')}
      </Link>
    </main>
  );
}

export function ErrorPage({ reset }: { reset?: () => void }) {
  const { t } = useTranslation();
  return (
    <main id="main" className="center-screen" role="alert">
      <h1 className="screen-title">{t('pages.error.title')}</h1>
      <p className="muted">{t('pages.error.body')}</p>
      <button
        type="button"
        className="btn btn--primary"
        onClick={() => (reset ? reset() : window.location.reload())}
      >
        {t('common.retry')}
      </button>
    </main>
  );
}

/** New Google users land here once: save their browser's language and time zone, then go to Today. */
export function WelcomePage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  useEffect(() => {
    void patch('/api/v1/me', { locale: currentLocale(), timeZone: browserTimeZone() })
      .catch(() => undefined)
      .finally(async () => {
        await qc.invalidateQueries({ queryKey: keys.me });
        await navigate({ to: '/today', replace: true });
      });
  }, [qc, navigate]);
  return (
    <main id="main" className="center-screen">
      <Spinner label={t('pages.welcome.loading')} />
      <p>{t('pages.welcome.loading')}</p>
    </main>
  );
}
