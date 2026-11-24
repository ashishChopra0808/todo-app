import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { clearOfflineData } from '../api/persist';
import { InstallApp, NotificationSettings } from '../components/NotificationSettings';
import { normalizePhone, type MeDto, type Theme } from '@todo/shared';
import { ApiError, api, del } from '../api/client';
import { keys, useMe, useSessions, useUpdateProfile } from '../api/queries';
import { Avatar } from '../components/Avatar';
import { Dialog } from '../components/Dialog';
import { FormError, PasswordField, Segmented, TextField } from '../components/Field';
import { Icon } from '../components/Icon';
import { LanguageSelect } from '../components/LanguageSelect';
import { OtpField } from '../components/OtpField';
import { PasswordStrength } from '../components/PasswordStrength';
import { Select } from '../components/Select';
import { ErrorState, LoadingList, Spinner } from '../components/States';
import { useToast } from '../components/Toasts';
import { authApi } from '../lib/auth-api';
import { errorMessage, fieldErrors } from '../lib/errors';
import { formatDateTime } from '../lib/format';
import { intlLocale } from '../lib/i18n';
import { applyTheme } from '../lib/theme';

function describeDevice(ua: string | null, t: (k: string) => string) {
  if (!ua) return t('settings.security.unknownDevice');
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : null;
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;
  return [browser, os].filter(Boolean).join(' · ') || t('settings.security.unknownDevice');
}

function ProfileSection({ me }: { me: MeDto }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const update = useUpdateProfile();
  const [name, setName] = useState(me.name);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const next = await api<MeDto>('PUT', '/api/v1/me/avatar', form);
      qc.setQueryData(keys.me, next);
      toast(t('settings.profile.saved'));
    } catch (err) {
      toast(errorMessage(err, t), { tone: 'error' });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <section className="settings-section" aria-labelledby="s-profile">
      <h2 id="s-profile" className="section-title">
        {t('settings.profile.title')}
      </h2>
      <div className="card stack-lg">
        <div className="row" style={{ gap: 16 }}>
          <Avatar name={me.name} url={me.avatarUrl} large />
          <div className="stack">
            <input
              ref={fileRef}
              id="avatar-file"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="visually-hidden"
              onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])}
            />
            <label
              htmlFor="avatar-file"
              className="btn btn--secondary btn--small"
              style={{ cursor: 'pointer' }}
            >
              {uploading && <Spinner />}
              {t('settings.profile.changePhoto')}
            </label>
            {me.avatarUrl && (
              <button
                type="button"
                className="text-link"
                onClick={async () => {
                  const next = await del<MeDto>('/api/v1/me/avatar');
                  qc.setQueryData(keys.me, next);
                }}
              >
                {t('settings.profile.removePhoto')}
              </button>
            )}
            <p className="meta">{t('settings.profile.photoHint')}</p>
          </div>
        </div>
        <form
          className="row"
          style={{ alignItems: 'flex-end' }}
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate(
              { name },
              {
                onSuccess: () => toast(t('settings.profile.saved')),
                onError: (err) => toast(errorMessage(err, t), { tone: 'error' }),
              },
            );
          }}
        >
          <div style={{ flex: 1, minInlineSize: 180 }}>
            <TextField
              label={t('settings.profile.name')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              autoComplete="name"
              error={update.isError ? fieldErrors(update.error, t).name : undefined}
            />
          </div>
          <button
            type="submit"
            className="btn btn--primary btn--small"
            disabled={update.isPending || !name.trim() || name === me.name}
          >
            {t('common.save')}
          </button>
        </form>
      </div>
    </section>
  );
}

function ContactDialog({
  kind,
  open,
  onClose,
}: {
  kind: 'email' | 'phone';
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const [value, setValue] = useState('');
  const [target, setTarget] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setValue('');
    setTarget(null);
    setCode('');
    setError(null);
    onClose();
  };

  async function send(e: FormEvent) {
    e.preventDefault();
    const normalized = kind === 'email' ? value.trim().toLowerCase() : normalizePhone(value);
    if (!normalized || (kind === 'email' && !/^\S+@\S+\.\S+$/.test(normalized))) {
      setError(t(kind === 'email' ? 'errors.field.invalid_email' : 'errors.field.invalid_phone'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await (kind === 'email'
        ? authApi.requestEmailChange(normalized)
        : authApi.requestPhoneChange(normalized));
      setTarget(normalized);
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e?: FormEvent, v = code) {
    e?.preventDefault();
    if (!target || v.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      await (kind === 'email'
        ? authApi.confirmEmailChange(target, v)
        : authApi.confirmPhoneChange(target, v));
      await qc.invalidateQueries({ queryKey: keys.me });
      toast(t('settings.contact.updated'));
      reset();
    } catch (err) {
      setError(errorMessage(err, t));
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={reset}
      title={kind === 'email' ? t('settings.contact.newEmail') : t('settings.contact.newPhone')}
    >
      {!target ? (
        <form className="form" onSubmit={send} noValidate>
          <p className="muted">{t('settings.contact.help')}</p>
          {kind === 'email' ? (
            <TextField
              label={t('settings.contact.newEmail')}
              type="email"
              autoComplete="email"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
            />
          ) : (
            <TextField
              label={t('settings.contact.newPhone')}
              type="tel"
              autoComplete="tel"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              hint={t('auth.fields.phoneHint')}
              autoFocus
            />
          )}
          <FormError message={error} />
          <div className="modal__actions">
            <button type="submit" className="btn btn--primary btn--block" disabled={busy || !value}>
              {busy && <Spinner />}
              {t('settings.contact.sendCode')}
            </button>
            <button type="button" className="btn btn--secondary btn--block" onClick={reset}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      ) : (
        <form className="form" onSubmit={confirm} noValidate>
          <p className="muted">
            {kind === 'email'
              ? t('auth.otp.sentToEmail', { target })
              : t('auth.otp.sentToPhone', { target })}
          </p>
          <OtpField
            value={code}
            onChange={setCode}
            onComplete={(v) => void confirm(undefined, v)}
            autoFocus
          />
          <FormError message={error} />
          <div className="modal__actions">
            <button
              type="submit"
              className="btn btn--primary btn--block"
              disabled={busy || code.length !== 6}
            >
              {busy && <Spinner />}
              {t('auth.otp.submit')}
            </button>
            <button type="button" className="btn btn--secondary btn--block" onClick={reset}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function ContactSection({ me }: { me: MeDto }) {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState<'email' | 'phone' | null>(null);
  const rows = [
    {
      kind: 'email' as const,
      label: t('settings.contact.email'),
      value: me.email,
      verified: me.emailVerified,
      add: t('settings.contact.addEmail'),
      change: t('settings.contact.changeEmail'),
    },
    {
      kind: 'phone' as const,
      label: t('settings.contact.phone'),
      value: me.phoneNumber,
      verified: me.phoneNumberVerified,
      add: t('settings.contact.addPhone'),
      change: t('settings.contact.changePhone'),
    },
  ];
  return (
    <section className="settings-section" aria-labelledby="s-contact">
      <h2 id="s-contact" className="section-title">
        {t('settings.contact.title')}
      </h2>
      <div className="list-card">
        {rows.map((r) => (
          <div key={r.kind} className="list-card__row">
            <div className="list-card__label">
              <span className="meta">{r.label}</span>
              <span style={{ fontWeight: 500 }}>{r.value ?? t('settings.contact.notAdded')}</span>
            </div>
            <div className="row">
              {r.value && r.verified && (
                <span className="badge-ok">{t('settings.contact.verified')}</span>
              )}
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={() => setDialog(r.kind)}
              >
                {r.value ? r.change : r.add}
              </button>
            </div>
          </div>
        ))}
        {me.providers.includes('google') && (
          <div className="list-card__row">
            <span>{t('settings.security.google')}</span>
          </div>
        )}
      </div>
      <ContactDialog
        kind={dialog ?? 'email'}
        open={dialog !== null}
        onClose={() => setDialog(null)}
      />
    </section>
  );
}

function PreferencesSection({ me }: { me: MeDto }) {
  const { t } = useTranslation();
  const toast = useToast();
  const update = useUpdateProfile();
  const zones = useMemo(() => {
    const list =
      typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
    return list.includes(me.timeZone) ? list : [me.timeZone, ...list];
  }, [me.timeZone]);
  // Local state so the control updates in the same frame as the click; the server save follows.
  const [theme, setTheme] = useState<Theme>(me.theme);
  const save = (input: Parameters<typeof update.mutate>[0]) =>
    update.mutate(input, { onError: (err) => toast(errorMessage(err, t), { tone: 'error' }) });
  return (
    <section className="settings-section" aria-labelledby="s-prefs">
      <h2 id="s-prefs" className="section-title">
        {t('settings.preferences.title')}
      </h2>
      <div className="card stack-lg">
        <LanguageSelect variant="field" onChange={(locale) => save({ locale })} />
        <Segmented<Theme>
          legend={t('settings.preferences.theme')}
          name="theme"
          value={theme}
          onChange={(next) => {
            setTheme(next);
            applyTheme(next);
            save({ theme: next });
          }}
          options={(['light', 'dark', 'system'] as const).map((v) => ({
            value: v,
            label: t(`settings.preferences.themes.${v}`),
          }))}
        />
        <Select
          label={t('settings.preferences.timeZone')}
          description={t('settings.preferences.timeZoneHint')}
          value={me.timeZone}
          onChange={(timeZone) => save({ timeZone })}
          options={zones.map((z) => ({ value: z, label: z.replace(/_/g, ' ') }))}
        />
      </div>
    </section>
  );
}

function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setCurrent('');
    setNext('');
    setError(null);
    onClose();
  };
  return (
    <Dialog open={open} onClose={close} title={t('settings.security.changePassword')}>
      <form
        className="form"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await authApi.changePassword(current, next);
            toast(t('settings.security.passwordChanged'));
            close();
          } catch (err) {
            setError(errorMessage(err, t));
          } finally {
            setBusy(false);
          }
        }}
      >
        <PasswordField
          label={t('settings.security.currentPassword')}
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <div className="stack">
          <PasswordField
            label={t('settings.security.newPassword')}
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            hint={t('auth.fields.passwordHint')}
          />
          <PasswordStrength password={next} inputs={[]} />
        </div>
        <FormError message={error} />
        <div className="modal__actions">
          <button
            type="submit"
            className="btn btn--primary btn--block"
            disabled={busy || !current || !next}
          >
            {busy && <Spinner />}
            {t('common.save')}
          </button>
          <button type="button" className="btn btn--secondary btn--block" onClick={close}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function SecuritySection({ me }: { me: MeDto }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const sessions = useSessions();
  const [pwOpen, setPwOpen] = useState(false);
  const [allOpen, setAllOpen] = useState(false);

  return (
    <section className="settings-section" aria-labelledby="s-security">
      <h2 id="s-security" className="section-title">
        {t('settings.security.title')}
      </h2>
      {me.hasPassword && (
        <button type="button" className="btn btn--secondary" onClick={() => setPwOpen(true)}>
          {t('settings.security.changePassword')}
        </button>
      )}
      <h3 className="field__label">{t('settings.security.sessions')}</h3>
      {sessions.isPending ? (
        <LoadingList rows={2} />
      ) : sessions.isError ? (
        <ErrorState
          message={errorMessage(sessions.error, t)}
          onRetry={() => void sessions.refetch()}
        />
      ) : (
        <ul className="list-card" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {sessions.data.map((s) => (
            <li key={s.id} className="list-card__row">
              <div className="list-card__label">
                <span style={{ fontWeight: 500 }}>
                  {describeDevice(s.userAgent, t)}
                  {s.current && ` · ${t('settings.security.thisDevice')}`}
                </span>
                <span className="meta">
                  {t('settings.security.since', {
                    date: formatDateTime(s.createdAt, me.timeZone, intlLocale()),
                  })}
                </span>
              </div>
              {!s.current && (
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={async () => {
                    await del(`/api/v1/me/sessions/${s.id}`);
                    await qc.invalidateQueries({ queryKey: keys.sessions });
                  }}
                >
                  {t('settings.security.signOutDevice')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn btn--danger-ghost" onClick={() => setAllOpen(true)}>
        <Icon name="logout" size={18} />
        {t('settings.security.signOutAll')}
      </button>
      <PasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />
      <Dialog
        open={allOpen}
        onClose={() => setAllOpen(false)}
        title={t('settings.security.signOutAllTitle')}
        role="alertdialog"
      >
        <p className="muted">{t('settings.security.signOutAllBody')}</p>
        <div className="modal__actions">
          <button
            type="button"
            className="btn btn--danger btn--block"
            onClick={async () => {
              try {
                await authApi.signOutAll();
                qc.clear();
                void clearOfflineData();
                await navigate({ to: '/sign-in' });
              } catch (err) {
                toast(errorMessage(err, t), { tone: 'error' });
              }
            }}
          >
            {t('settings.security.signOutAll')}
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--block"
            onClick={() => setAllOpen(false)}
          >
            {t('common.cancel')}
          </button>
        </div>
      </Dialog>
    </section>
  );
}

function DataSection({ me }: { me: MeDto }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function exportData() {
    try {
      const res = await fetch('/api/v1/me/export', { credentials: 'same-origin' });
      if (!res.ok)
        throw new ApiError(
          res.status,
          res.status === 429 ? 'rate_limited' : 'internal',
          'export failed',
        );
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `todo-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast(t('settings.privacy.exportDone'));
    } catch (err) {
      toast(errorMessage(err, t), { tone: 'error' });
    }
  }

  async function deleteAccount(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await del('/api/v1/me', {
        confirm: confirmText.trim(),
        password: me.hasPassword ? password : undefined,
      });
      qc.clear();
      void clearOfflineData();
      await navigate({ to: '/sign-in', search: { deleted: '1' } });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'reauth_required') {
        setError(t('settings.privacy.deleteReauth'));
      } else {
        setError(errorMessage(err, t));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-section" aria-labelledby="s-data">
      <h2 id="s-data" className="section-title">
        {t('settings.privacy.title')}
      </h2>
      <div className="card stack">
        <p className="muted">{t('settings.privacy.exportBody')}</p>
        <button type="button" className="btn btn--secondary" onClick={exportData}>
          <Icon name="download" size={18} />
          {t('settings.privacy.export')}
        </button>
      </div>
      <div className="card stack">
        <p className="muted">{t('settings.privacy.deleteBody')}</p>
        <button type="button" className="btn btn--danger-ghost" onClick={() => setOpen(true)}>
          <Icon name="trash" size={18} />
          {t('settings.privacy.delete')}
        </button>
      </div>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('settings.privacy.deleteTitle')}
        role="alertdialog"
      >
        <form className="form" onSubmit={deleteAccount} noValidate>
          <p className="muted">{t('settings.privacy.deleteBody')}</p>
          <TextField
            label={t('settings.privacy.deleteConfirmLabel')}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
          />
          {me.hasPassword && (
            <PasswordField
              label={t('settings.privacy.deletePassword')}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
          <FormError message={error} />
          <div className="modal__actions">
            <button
              type="submit"
              className="btn btn--danger btn--block"
              disabled={busy || confirmText.trim() !== 'DELETE' || (me.hasPassword && !password)}
            >
              {busy && <Spinner />}
              {t('settings.privacy.deleteSubmit')}
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--block"
              onClick={() => setOpen(false)}
            >
              {t('common.cancel')}
            </button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}

/** Simple mode: big buttons, voice first, no typing. Usually switched on by a family member. */
function SimpleModeSection({ me }: { me: MeDto }) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const update = useUpdateProfile();
  return (
    <section className="settings-section" aria-labelledby="s-simple">
      <h2 id="s-simple" className="section-title">
        {t('simpleSettings.title')}
      </h2>
      <div className="card stack">
        <p className="muted">{t('simpleSettings.body')}</p>
        <button
          type="button"
          className="btn btn--secondary"
          style={{ alignSelf: 'flex-start' }}
          aria-pressed={me.simpleMode}
          disabled={update.isPending}
          onClick={() =>
            update.mutate(
              { simpleMode: !me.simpleMode },
              {
                onSuccess: (next) => {
                  if (next.simpleMode) void navigate({ to: '/simple' });
                  else toast(t('simpleSettings.off'));
                },
                onError: (err) => toast(errorMessage(err, t), { tone: 'error' }),
              },
            )
          }
        >
          {me.simpleMode ? t('simpleSettings.turnOff') : t('simpleSettings.turnOn')}
        </button>
      </div>
    </section>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  if (me.isPending) {
    return (
      <main id="main" className="page">
        <LoadingList rows={5} />
      </main>
    );
  }
  if (me.isError) {
    return (
      <main id="main" className="page">
        <ErrorState message={errorMessage(me.error, t)} onRetry={() => void me.refetch()} />
      </main>
    );
  }
  return (
    <main id="main" className="page">
      <h1 className="screen-title">{t('settings.title')}</h1>
      <ProfileSection me={me.data} />
      <ContactSection me={me.data} />
      <PreferencesSection me={me.data} />
      <section className="settings-section" id="notifications" aria-labelledby="s-notify">
        <h2 id="s-notify" className="section-title">
          {t('notifySettings.title')}
        </h2>
        <div className="card">
          <NotificationSettings />
        </div>
      </section>
      <SimpleModeSection me={me.data} />
      <section className="settings-section" aria-labelledby="s-app">
        <h2 id="s-app" className="section-title">
          {t('install.title')}
        </h2>
        <div className="card stack">
          <InstallApp />
        </div>
      </section>
      <SecuritySection me={me.data} />
      <DataSection me={me.data} />
      <section className="settings-section" aria-labelledby="s-about">
        <h2 id="s-about" className="section-title">
          {t('settings.legal.title')}
        </h2>
        <div className="list-card">
          {(['terms', 'privacy', 'grievance'] as const).map((p) => (
            <Link
              key={p}
              to="/legal/$page"
              params={{ page: p }}
              className="list-card__row"
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <span>{t(`settings.legal.${p}`)}</span>
              <Icon name="chevronRight" size={18} />
            </Link>
          ))}
        </div>
        <p className="meta">
          {t('settings.legal.version', { version: import.meta.env.VITE_APP_VERSION ?? 'dev' })}
        </p>
      </section>
      <button
        type="button"
        className="btn btn--secondary"
        onClick={async () => {
          await authApi.signOut().catch(() => undefined);
          qc.clear();
          void clearOfflineData();
          await navigate({ to: '/sign-in' });
        }}
      >
        <Icon name="logout" size={18} />
        {t('common.signOut')}
      </button>
    </main>
  );
}
