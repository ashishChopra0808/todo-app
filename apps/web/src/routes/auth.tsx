import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import {
  forgetAuthTarget,
  readAuthTarget,
  rememberAuthTarget,
  type AuthTarget,
} from '../lib/auth-target';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { OTP, normalizePhone } from '@todo/shared';
import { ApiError } from '../api/client';
import { keys, meQuery } from '../api/queries';
import { FormError, PasswordField, Segmented, TextField } from '../components/Field';
import { StagingSmsNote, usePublicConfig } from '../components/StagingSmsNote';
import { Icon } from '../components/Icon';
import { LanguageSelect } from '../components/LanguageSelect';
import { OtpField, mmss, useCountdown } from '../components/OtpField';
import { PasswordStrength } from '../components/PasswordStrength';
import { Spinner } from '../components/States';
import { authApi, browserTimeZone, displayTarget, type Channel } from '../lib/auth-api';
import { errorMessage, fieldErrors } from '../lib/errors';
import { currentLocale } from '../lib/i18n';

function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main id="main" className="page page--narrow">
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <LanguageSelect />
      </div>
      <div className="stack-lg" style={{ paddingBlockStart: 8 }}>
        <div className="brand-mark" aria-hidden="true">
          <Icon name="check" size={28} />
        </div>
        <h1 className="screen-title">{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {children}
      {footer && (
        <div
          className="stack"
          style={{ marginBlockStart: 'auto', alignItems: 'center', textAlign: 'center' }}
        >
          {footer}
        </div>
      )}
    </main>
  );
}

const legalLinks = {
  terms: <Link to="/legal/$page" params={{ page: 'terms' }} />,
  privacy: <Link to="/legal/$page" params={{ page: 'privacy' }} />,
};

function ChannelSwitch({ value, onChange }: { value: Channel; onChange: (c: Channel) => void }) {
  const { t } = useTranslation();
  return (
    <Segmented
      legend={t('auth.method.label')}
      legendHidden
      name="channel"
      value={value}
      onChange={onChange}
      options={[
        { value: 'email', label: t('auth.method.email') },
        { value: 'phone', label: t('auth.method.phone') },
      ]}
    />
  );
}

function IdentifierField({
  channel,
  value,
  onChange,
  error,
  autoFocus,
}: {
  channel: Channel;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  return channel === 'email' ? (
    <TextField
      label={t('auth.fields.email')}
      type="email"
      name="email"
      autoComplete="email"
      inputMode="email"
      placeholder="you@example.com"
      required
      value={value}
      onChange={(e) => onChange(e.target.value)}
      error={error}
      autoFocus={autoFocus}
    />
  ) : (
    <TextField
      label={t('auth.fields.phone')}
      type="tel"
      name="phone"
      autoComplete="tel"
      inputMode="tel"
      placeholder="98765 43210"
      required
      value={value}
      onChange={(e) => onChange(e.target.value)}
      hint={t('auth.fields.phoneHint')}
      error={error}
      autoFocus={autoFocus}
    />
  );
}

function GoogleButton() {
  const { t } = useTranslation();
  const cfg = usePublicConfig();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!cfg.data?.googleEnabled) return null;
  return (
    <>
      <div className="divider">{t('common.or')}</div>
      <FormError message={error} />
      <button
        type="button"
        className="btn btn--secondary btn--block"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const { url } = await authApi.google();
            window.location.assign(url);
          } catch (err) {
            setError(errorMessage(err, t));
            setBusy(false);
          }
        }}
      >
        {busy && <Spinner />}
        {t('auth.google')}
      </button>
      <p className="meta" style={{ textAlign: 'center' }}>
        <Trans i18nKey="auth.googleNotice" components={legalLinks} />
      </p>
    </>
  );
}

export function SignInPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const search = useSearch({ strict: false }) as {
    redirect?: string;
    reset?: string;
    error?: string;
    deleted?: string;
  };
  const [channel, setChannel] = useState<Channel>('email');
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    search.error === 'google' ? t('auth.callback.failed') : null,
  );

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Read what is actually in the boxes: iPhone autofill (Keychain, Chrome) can fill them
    // without telling React, which used to leave the button disabled and the tap ignored.
    const form = new FormData(e.currentTarget);
    const idNow = String(form.get(channel === 'email' ? 'email' : 'phone') ?? id).trim() || id;
    const passwordNow = String(form.get('password') ?? password) || password;
    if (idNow !== id) setId(idNow);
    if (passwordNow !== password) setPassword(passwordNow);
    const missing: Record<string, string> = {};
    if (!idNow) missing.id = t('errors.field.required');
    if (!passwordNow) missing.password = t('errors.field.required');
    setFields(missing);
    if (Object.keys(missing).length) {
      setError(null);
      // Take the person to the first empty box.
      const first = e.currentTarget.querySelector<HTMLInputElement>(
        missing.id
          ? `input[name="${channel === 'email' ? 'email' : 'phone'}"]`
          : 'input[name="password"]',
      );
      first?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await authApi.signIn(channel, idNow, passwordNow);
      // Load the signed-in profile before leaving, so the next page (e.g. an invite) never
      // shows the signed-out version while it re-checks.
      await qc.fetchQuery({ ...meQuery, staleTime: 0 }).catch(() => undefined);
      const target =
        search.redirect && search.redirect.startsWith('/') && !search.redirect.startsWith('//')
          ? search.redirect
          : '/today';
      await navigate({ to: target });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'not_verified') {
        const target = channel === 'email' ? idNow.toLowerCase() : (normalizePhone(idNow) ?? idNow);
        await authApi.sendVerification(channel, target).catch(() => undefined);
        rememberAuthTarget({ channel, target });
        await navigate({ to: '/verify', search: { channel, purpose: 'signin' } });
        return;
      }
      if (err instanceof ApiError && err.code === 'account_suspended') {
        await navigate({ to: '/suspended' });
        return;
      }
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title={t('auth.signIn.title')}
      subtitle={t('app.tagline')}
      footer={
        <p className="muted">
          {t('auth.signIn.noAccount')}{' '}
          <Link to="/sign-up" className="text-link">
            {t('auth.signIn.createAccount')}
          </Link>
        </p>
      }
    >
      {search.reset && (
        <div className="form-success" role="status">
          {t('auth.forgot.success')}
        </div>
      )}
      {search.deleted && (
        <div className="form-success" role="status">
          {t('settings.privacy.deleted')}
        </div>
      )}
      <form className="form" onSubmit={submit} noValidate>
        <ChannelSwitch
          value={channel}
          onChange={(c) => {
            setChannel(c);
            setId('');
            setError(null);
            setFields({});
          }}
        />
        <IdentifierField
          channel={channel}
          value={id}
          onChange={(v) => {
            setId(v);
            if (fields.id && v.trim()) setFields(({ id: _, ...rest }) => rest);
          }}
          error={fields.id}
        />
        <div className="stack">
          <PasswordField
            label={t('auth.fields.password')}
            name="password"
            autoComplete="current-password"
            required
            value={password}
            error={fields.password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (fields.password && e.target.value) setFields(({ password: _, ...rest }) => rest);
            }}
          />
          <Link
            to="/forgot"
            className="text-link"
            style={{ alignSelf: 'flex-end', fontWeight: 500 }}
          >
            {t('auth.signIn.forgot')}
          </Link>
        </div>
        <FormError message={error} />
        <button className="btn btn--primary btn--block" type="submit" disabled={busy}>
          {busy && <Spinner />}
          {t('auth.signIn.submit')}
        </button>
        <GoogleButton />
      </form>
    </AuthLayout>
  );
}

export function SignUpPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [channel, setChannel] = useState<Channel>('email');
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function submit(e: FormEvent) {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!name.trim()) local.name = t('errors.field.required');
    if (channel === 'phone' && !normalizePhone(id))
      local.phoneNumber = t('errors.field.invalid_phone');
    if (channel === 'email' && !/^\S+@\S+\.\S+$/.test(id.trim()))
      local.email = t('errors.field.invalid_email');
    if (!accept) local.acceptTerms = t('errors.field.consent_required');
    setFields(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    setError(null);
    const common = {
      name,
      password,
      acceptTerms: accept,
      locale: currentLocale(),
      timeZone: browserTimeZone(),
    };
    try {
      if (channel === 'email') {
        const email = id.trim().toLowerCase();
        await authApi.signUpEmail({ ...common, email });
        rememberAuthTarget({ channel, target: email });
        await navigate({ to: '/verify', search: { channel, purpose: 'signup' } });
      } else {
        const res = await authApi.signUpPhone({ ...common, phoneNumber: id });
        rememberAuthTarget({ channel, target: res.phoneNumber });
        await navigate({ to: '/verify', search: { channel, purpose: 'signup' } });
      }
    } catch (err) {
      setFields(fieldErrors(err, t));
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title={t('auth.signUp.title')}
      subtitle={t('auth.signUp.subtitle')}
      footer={
        <p className="muted">
          {t('auth.signUp.haveAccount')}{' '}
          <Link to="/sign-in" className="text-link">
            {t('auth.signUp.signIn')}
          </Link>
        </p>
      }
    >
      <form className="form" onSubmit={submit} noValidate>
        <ChannelSwitch
          value={channel}
          onChange={(c) => {
            setChannel(c);
            setId('');
            setFields({});
          }}
        />
        <TextField
          label={t('auth.fields.name')}
          name="name"
          autoComplete="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={fields.name}
          maxLength={80}
        />
        <IdentifierField
          channel={channel}
          value={id}
          onChange={setId}
          error={fields.email ?? fields.phoneNumber}
        />
        <div className="stack">
          <PasswordField
            label={t('auth.fields.password')}
            name="new-password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint={t('auth.fields.passwordHint')}
            error={fields.password}
          />
          <PasswordStrength password={password} inputs={[name, id]} />
        </div>
        <div className="field">
          <label className="check">
            <input
              type="checkbox"
              checked={accept}
              onChange={(e) => setAccept(e.target.checked)}
              aria-invalid={!!fields.acceptTerms || undefined}
              aria-describedby={fields.acceptTerms ? 'consent-error' : undefined}
            />
            <span>
              <Trans i18nKey="auth.signUp.consent" components={legalLinks} />
            </span>
          </label>
          {fields.acceptTerms && (
            <p id="consent-error" className="field__error">
              {fields.acceptTerms}
            </p>
          )}
        </div>
        <FormError message={error} />
        <button className="btn btn--primary btn--block" type="submit" disabled={busy}>
          {busy && <Spinner />}
          {t('auth.signUp.submit')}
        </button>
        <GoogleButton />
      </form>
    </AuthLayout>
  );
}

/**
 * The address a code went to, for the code screens. Comes from session storage; an old link
 * with it in the URL is moved there and the URL cleaned. Nothing at all → back to `fallback`.
 */
function useAuthTargetFromPage(fallback: '/sign-in' | '/forgot'): AuthTarget {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as {
    channel?: Channel;
    target?: string;
    purpose?: string;
  };
  const [found] = useState<AuthTarget | null>(() => {
    if (search.target) {
      const t = { channel: search.channel ?? 'email', target: search.target } as AuthTarget;
      rememberAuthTarget(t);
      return t;
    }
    return readAuthTarget();
  });
  useEffect(() => {
    if (!found) {
      void navigate({ to: fallback, replace: true });
    } else if (search.target) {
      const { target: _drop, ...rest } = search;
      void navigate({ to: '.', search: rest as never, replace: true });
    }
  }, [found, search, navigate, fallback]);
  return found ?? { channel: search.channel ?? 'email', target: '' };
}

export function VerifyPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { channel, target } = useAuthTargetFromPage('/sign-in');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const expiry = useCountdown(OTP.expiresInSeconds);
  const cooldown = useCountdown(OTP.resendCooldownSeconds);

  async function verify(value = code) {
    if (value.length !== OTP.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      await authApi.verify(channel, target, value);
      forgetAuthTarget();
      await qc.invalidateQueries({ queryKey: keys.me });
      await navigate({ to: '/today' });
    } catch (err) {
      setError(errorMessage(err, t));
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    try {
      await authApi.sendVerification(channel, target);
      setInfo(t('auth.otp.resent'));
      expiry.restart();
      cooldown.restart();
    } catch (err) {
      setError(errorMessage(err, t));
      if (err instanceof ApiError && err.retryAfterSeconds) cooldown.restart(err.retryAfterSeconds);
    }
  }

  if (!channel || !target) {
    return (
      <AuthLayout title={t('auth.otp.title')}>
        <Link to="/sign-in" className="btn btn--secondary btn--block">
          {t('auth.forgot.backToSignIn')}
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={t('auth.otp.title')}
      subtitle={
        channel === 'email' ? (
          t('auth.otp.sentToEmail', { target: displayTarget(channel, target) })
        ) : (
          <>
            {t('auth.otp.sentToPhone', { target: displayTarget(channel, target) })}
            <StagingSmsNote kind="code" />
          </>
        )
      }
      footer={
        <Link to="/sign-up" className="text-link">
          {t('auth.otp.useDifferent')}
        </Link>
      }
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void verify();
        }}
        noValidate
      >
        <OtpField value={code} onChange={setCode} onComplete={(v) => void verify(v)} autoFocus />
        <p className="meta" aria-live="off">
          {expiry.left > 0
            ? t('auth.otp.expiresIn', { time: mmss(expiry.left) })
            : t('auth.otp.expired')}
        </p>
        <FormError message={error} />
        {info && !error && (
          <div className="form-success" role="status">
            {info}
          </div>
        )}
        <button
          className="btn btn--primary btn--block"
          type="submit"
          disabled={busy || code.length !== OTP.length}
        >
          {busy && <Spinner />}
          {t('auth.otp.submit')}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={resend}
          disabled={cooldown.left > 0}
          aria-disabled={cooldown.left > 0}
        >
          {cooldown.left > 0
            ? t('auth.otp.resendIn', { seconds: cooldown.left })
            : t('auth.otp.resend')}
        </button>
      </form>
    </AuthLayout>
  );
}

export function ForgotPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [channel, setChannel] = useState<Channel>('email');
  const [id, setId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const target = channel === 'email' ? id.trim().toLowerCase() : normalizePhone(id);
    if (!target) {
      setError(
        t(channel === 'email' ? 'errors.field.invalid_email' : 'errors.field.invalid_phone'),
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await authApi.requestReset(channel, target);
      rememberAuthTarget({ channel, target });
      await navigate({ to: '/reset', search: { channel } });
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title={t('auth.forgot.title')}
      subtitle={t('auth.forgot.subtitle')}
      footer={
        <Link to="/sign-in" className="text-link">
          {t('auth.forgot.backToSignIn')}
        </Link>
      }
    >
      <form className="form" onSubmit={submit} noValidate>
        <ChannelSwitch
          value={channel}
          onChange={(c) => {
            setChannel(c);
            setId('');
          }}
        />
        <IdentifierField channel={channel} value={id} onChange={setId} autoFocus />
        <FormError message={error} />
        <button className="btn btn--primary btn--block" type="submit" disabled={busy || !id}>
          {busy && <Spinner />}
          {t('auth.forgot.submit')}
        </button>
      </form>
    </AuthLayout>
  );
}

export function ResetPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { channel, target } = useAuthTargetFromPage('/forgot');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const cooldown = useCountdown(OTP.resendCooldownSeconds);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (code.length !== OTP.length) {
      setFields({ otp: t('errors.field.invalid_otp') });
      return;
    }
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await authApi.reset(channel, target, code, password);
      forgetAuthTarget();
      await navigate({ to: '/sign-in', search: { reset: '1' } });
    } catch (err) {
      setError(errorMessage(err, t));
      setFields(fieldErrors(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title={t('auth.forgot.resetTitle')}
      subtitle={
        channel === 'email' ? (
          t('auth.otp.sentToEmail', { target })
        ) : (
          <>
            {t('auth.otp.sentToPhone', { target: displayTarget('phone', target ?? '') })}
            <StagingSmsNote kind="code" />
          </>
        )
      }
      footer={
        <Link to="/sign-in" className="text-link">
          {t('auth.forgot.backToSignIn')}
        </Link>
      }
    >
      <form className="form" onSubmit={submit} noValidate>
        <OtpField value={code} onChange={setCode} error={fields.otp} autoFocus />
        <div className="stack">
          <PasswordField
            label={t('auth.fields.newPassword')}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint={t('auth.fields.passwordHint')}
            error={fields.password ?? fields.newPassword}
          />
          <PasswordStrength password={password} inputs={[target ?? '']} />
        </div>
        <FormError message={error} />
        <button className="btn btn--primary btn--block" type="submit" disabled={busy || !password}>
          {busy && <Spinner />}
          {t('auth.forgot.resetSubmit')}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          disabled={cooldown.left > 0}
          onClick={async () => {
            try {
              await authApi.requestReset(channel, target);
              cooldown.restart();
            } catch (err) {
              setError(errorMessage(err, t));
            }
          }}
        >
          {cooldown.left > 0
            ? t('auth.otp.resendIn', { seconds: cooldown.left })
            : t('auth.otp.resend')}
        </button>
      </form>
    </AuthLayout>
  );
}

export function SuspendedPage() {
  const { t } = useTranslation();
  return (
    <AuthLayout title={t('auth.suspended.title')} subtitle={t('auth.suspended.body')}>
      <Link
        to="/legal/$page"
        params={{ page: 'grievance' }}
        className="btn btn--primary btn--block"
      >
        {t('auth.suspended.contact')}
      </Link>
      <Link to="/sign-in" className="btn btn--ghost">
        {t('auth.forgot.backToSignIn')}
      </Link>
    </AuthLayout>
  );
}
