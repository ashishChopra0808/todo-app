import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { GROUPS, normalizePhone, type GroupDto, type InviteDto } from '@todo/shared';
import { useCreateInvite } from '../api/queries';
import { errorMessage, fieldErrors } from '../lib/errors';
import { Dialog } from './Dialog';
import { FormError, Segmented, TextField } from './Field';
import { Icon } from './Icon';
import { Spinner } from './States';
import { useToast } from './Toasts';

export const inviteLink = (code: string) => `${window.location.origin}/join/${code}`;
/** ABCDE-FGHIJ: easier to read aloud or type from another screen. */
export const prettyCode = (code: string) => `${code.slice(0, 5)}-${code.slice(5)}`;

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Invite sheet: a shareable link and code (made when the sheet opens), plus invite by email or SMS.
 * Link invites work for 7 days and up to 20 people; email/SMS invites are single use.
 */
export function InviteDialog({
  group,
  open,
  onClose,
}: {
  group: GroupDto;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const create = useCreateInvite(group.id);
  const [link, setLink] = useState<InviteDto | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [mode, setMode] = useState<'email' | 'phone'>('email');
  const [target, setTarget] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const requested = useRef(false);

  // One link invite per opening of the sheet.
  useEffect(() => {
    if (!open) {
      requested.current = false;
      return;
    }
    if (requested.current) return;
    requested.current = true;
    setLink(null);
    setLinkError(null);
    create
      .mutateAsync({ channel: 'link' })
      .then(setLink)
      .catch((err: unknown) => setLinkError(errorMessage(err, t)));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;

  async function share() {
    if (!link) return;
    const url = inviteLink(link.code);
    try {
      await navigator.share({ title: t('invite.shareText', { group: group.name }), url });
    } catch {
      /* cancelled */
    }
  }

  async function sendTargeted(e: FormEvent) {
    e.preventDefault();
    const value = target.trim();
    const local: Record<string, string> = {};
    if (mode === 'email' && !/^\S+@\S+\.\S+$/.test(value))
      local[mode] = t('errors.field.invalid_email');
    if (mode === 'phone' && !normalizePhone(value)) local[mode] = t('errors.field.invalid_phone');
    setFields(local);
    setError(null);
    if (Object.keys(local).length) return;
    setSending(true);
    try {
      const inv = await create.mutateAsync(
        mode === 'email' ? { channel: 'email', email: value } : { channel: 'phone', phone: value },
      );
      toast(
        mode === 'email'
          ? t('invite.sentEmail', { target: inv.target ?? '' })
          : t('invite.sentPhone', { target: inv.target ?? '' }),
      );
      setTarget('');
    } catch (err) {
      setFields(fieldErrors(err, t));
      setError(errorMessage(err, t));
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('invite.title', { name: group.name })}>
      <section className="stack" aria-labelledby="invite-link-h">
        <h3 id="invite-link-h" className="section-title">
          {t('invite.linkTitle')}
        </h3>
        {linkError ? (
          <FormError message={linkError} />
        ) : !link ? (
          <p className="meta" role="status">
            <Spinner /> {t('invite.making')}
          </p>
        ) : (
          <>
            <div className="invite-code" aria-live="polite">
              <span className="meta">{t('invite.code')}</span>
              <span className="invite-code__value" aria-label={link.code.split('').join(' ')}>
                {prettyCode(link.code)}
              </span>
            </div>
            <p className="field__hint">
              {t('invite.codeHint', {
                days: GROUPS.linkInviteDays,
                uses: GROUPS.linkInviteMaxUses,
              })}
            </p>
            <div className="row">
              {canShare && (
                <button type="button" className="btn btn--primary btn--small" onClick={share}>
                  <Icon name="share" size={18} />
                  {t('invite.share')}
                </button>
              )}
              <button
                type="button"
                className={`btn btn--small ${canShare ? 'btn--secondary' : 'btn--primary'}`}
                onClick={async () =>
                  toast(
                    (await copyText(inviteLink(link.code)))
                      ? t('invite.copied')
                      : t('invite.copyFailed'),
                  )
                }
              >
                <Icon name="copy" size={18} />
                {t('invite.copyLink')}
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={async () =>
                  toast(
                    (await copyText(link.code)) ? t('invite.codeCopied') : t('invite.copyFailed'),
                  )
                }
              >
                {t('invite.copyCode')}
              </button>
            </div>
          </>
        )}
      </section>

      <form className="form" onSubmit={sendTargeted} noValidate aria-labelledby="invite-direct-h">
        <h3 id="invite-direct-h" className="section-title">
          {t('invite.directTitle')}
        </h3>
        <Segmented
          legend={t('invite.directTitle')}
          legendHidden
          name="invite-mode"
          value={mode}
          onChange={(m) => {
            setMode(m);
            setTarget('');
            setFields({});
            setError(null);
          }}
          options={[
            { value: 'email', label: t('auth.method.email') },
            { value: 'phone', label: t('auth.method.phone') },
          ]}
        />
        {mode === 'email' ? (
          <TextField
            key="email"
            label={t('auth.fields.email')}
            type="email"
            inputMode="email"
            autoComplete="off"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            error={fields.email}
            hint={t('invite.targetHint')}
          />
        ) : (
          <TextField
            key="phone"
            label={t('auth.fields.phone')}
            type="tel"
            inputMode="tel"
            autoComplete="off"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            error={fields.phone}
            hint={t('invite.targetHint')}
          />
        )}
        <FormError message={error} />
        <button
          type="submit"
          className="btn btn--secondary"
          style={{ alignSelf: 'flex-start' }}
          disabled={sending}
        >
          {sending ? <Spinner /> : <Icon name={mode === 'email' ? 'mail' : 'phone'} size={18} />}
          {t('invite.send')}
        </button>
      </form>

      <div className="modal__actions modal__footer">
        <button type="button" className="btn btn--secondary btn--block" onClick={onClose}>
          {t('common.done')}
        </button>
      </div>
    </Dialog>
  );
}
