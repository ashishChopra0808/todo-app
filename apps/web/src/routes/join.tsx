import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { inviteCodeSchema } from '@todo/shared';
import { ApiError } from '../api/client';
import { meQuery, useAcceptInvite, useInvitePreview } from '../api/queries';
import { TextField, FormError } from '../components/Field';
import { GroupIcon } from '../components/GroupBits';
import { Icon } from '../components/Icon';
import { LoadingList, Spinner } from '../components/States';
import { useToast } from '../components/Toasts';
import { errorMessage } from '../lib/errors';
import { rememberPendingJoin, takePendingJoin } from '../lib/pending-join';

/** "Have an invite code?" — typed codes go to the same join page as links. */
export function JoinWithCode() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = inviteCodeSchema.safeParse(code);
    if (!parsed.success) {
      setError(t('join.badCode'));
      return;
    }
    void navigate({ to: '/join/$code', params: { code: parsed.data } });
  }
  return (
    <form className="card form" onSubmit={submit} noValidate>
      <TextField
        label={t('join.haveCode')}
        placeholder="ABCDE-FGHIJ"
        value={code}
        onChange={(e) => {
          setCode(e.target.value);
          setError(undefined);
        }}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        maxLength={14}
        error={error}
      />
      <button type="submit" className="btn btn--secondary" style={{ alignSelf: 'flex-start' }}>
        {t('common.continue')}
      </button>
    </form>
  );
}

export function JoinPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const { code } = useParams({ strict: false }) as { code: string };
  const me = useQuery({ ...meQuery, retry: false, staleTime: 0 });
  const signedIn = !!me.data;
  const preview = useInvitePreview(code);
  const accept = useAcceptInvite();
  const [error, setError] = useState<string | null>(null);
  const here = `/join/${code}`;

  // Back on the invite while signed in: the saved "return to this invite" note has done its job.
  // Left behind, it would send people back here again right after they join.
  useEffect(() => {
    if (signedIn) takePendingJoin();
  }, [signedIn]);

  async function join() {
    setError(null);
    try {
      const g = await accept.mutateAsync(code);
      takePendingJoin();
      toast(t('join.joined', { name: g.name }));
      await navigate({ to: '/groups/$id', params: { id: g.id }, replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invite_invalid') {
        const reason = (err.details as { reason?: string } | undefined)?.reason ?? 'not_found';
        setError(t(`join.invalid.${reason}`, { defaultValue: t('join.invalid.not_found') }));
      } else setError(errorMessage(err, t));
    }
  }

  let body;
  if (preview.isPending || me.isPending || me.isFetching) body = <LoadingList rows={2} />;
  else if (preview.isError) {
    const err = preview.error;
    const reason =
      err instanceof ApiError && err.code === 'invite_invalid'
        ? ((err.details as { reason?: string } | undefined)?.reason ?? 'not_found')
        : err instanceof ApiError && err.status === 400
          ? 'not_found'
          : null;
    body = (
      <div className="stack" role="alert">
        <h2 className="section-title">{t('join.invalid.title')}</h2>
        <p className="muted">
          {reason
            ? t(`join.invalid.${reason}`, { defaultValue: t('join.invalid.not_found') })
            : errorMessage(err, t)}
        </p>
        <Link to={signedIn ? '/groups' : '/sign-in'} className="btn btn--secondary">
          {signedIn ? t('groups.title') : t('join.signIn')}
        </Link>
      </div>
    );
  } else {
    const p = preview.data;
    body = (
      <div className="stack-lg">
        <div className="join-card">
          <GroupIcon group={p.group} size="lg" />
          <div className="stack" style={{ gap: 4 }}>
            {p.inviterFirstName && (
              <p className="meta">{t('join.invitedBy', { name: p.inviterFirstName })}</p>
            )}
            <h2 className="screen-title" style={{ overflowWrap: 'anywhere' }}>
              {p.group.name}
            </h2>
            <p className="meta">{t('groups.members', { count: p.memberCount })}</p>
          </div>
        </div>
        {p.restricted !== 'link' && !p.alreadyMember && (
          <p className="muted">
            {p.restricted === 'email' ? t('join.restrictedEmail') : t('join.restrictedPhone')}
          </p>
        )}
        <FormError message={error} />
        {p.alreadyMember ? (
          <>
            <p className="muted">{t('join.alreadyMember')}</p>
            <Link
              to="/groups/$id"
              params={{ id: p.group.id }}
              className="btn btn--primary btn--block"
            >
              {t('join.open')}
            </Link>
          </>
        ) : signedIn ? (
          <button
            type="button"
            className="btn btn--primary btn--block"
            onClick={join}
            disabled={accept.isPending}
          >
            {accept.isPending && <Spinner />}
            {t('join.join')}
          </button>
        ) : (
          <div className="stack">
            <p className="muted">{t('join.signInFirst')}</p>
            <Link
              to="/sign-up"
              className="btn btn--primary btn--block"
              onClick={() => rememberPendingJoin(code)}
            >
              {t('join.signUp')}
            </Link>
            <Link
              to="/sign-in"
              search={{ redirect: here }}
              className="btn btn--secondary btn--block"
              onClick={() => rememberPendingJoin(code)}
            >
              {t('join.signIn')}
            </Link>
          </div>
        )}
      </div>
    );
  }

  return (
    <main id="main" className="center-screen" style={{ padding: 24 }}>
      <div className="stack-lg" style={{ inlineSize: '100%', maxInlineSize: 440 }}>
        <div className="row" style={{ gap: 12 }}>
          <span className="brand-mark brand-mark--sm" aria-hidden="true">
            <Icon name="check" size={20} />
          </span>
          <h1 style={{ fontSize: 18, fontWeight: 600 }}>{t('join.title')}</h1>
        </div>
        <div className="card stack-lg">{body}</div>
      </div>
    </main>
  );
}
