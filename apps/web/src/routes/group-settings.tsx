import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { LIMITS, type GroupDto, type GroupMemberDto } from '@todo/shared';
import { ApiError } from '../api/client';
import {
  useChangeRole,
  useDeleteGroup,
  useGroup,
  useInvites,
  useMe,
  useMembers,
  useRemoveMember,
  useRevokeInvite,
  useUpdateGroup,
} from '../api/queries';
import { Dialog } from '../components/Dialog';
import { FormError, TextField } from '../components/Field';
import { MiniAvatar } from '../components/GroupBits';
import { Icon } from '../components/Icon';
import { copyText, inviteLink, prettyCode } from '../components/InviteDialog';
import { ReportDialog } from '../components/ReportDialog';
import { ErrorState, LoadingList, Spinner } from '../components/States';
import { useToast } from '../components/Toasts';
import { errorMessage, fieldErrors } from '../lib/errors';
import { formatDateTime } from '../lib/format';
import { intlLocale } from '../lib/i18n';
import { IconPicker } from '../components/NewGroupDialog';

function DetailsSection({ g }: { g: GroupDto }) {
  const { t } = useTranslation();
  const toast = useToast();
  const update = useUpdateGroup(g.id);
  const [name, setName] = useState(g.name);
  const [icon, setIcon] = useState<string | null>(g.icon);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await update.mutateAsync({ name, icon });
      setFields({});
      toast(t('groupSettings.saved'));
    } catch (err) {
      setFields(fieldErrors(err, t));
      setError(errorMessage(err, t));
    }
  }

  return (
    <section className="settings-section" aria-labelledby="gs-details">
      <h2 id="gs-details" className="section-title">
        {t('groupSettings.details')}
      </h2>
      <form className="card form" onSubmit={save} noValidate>
        <TextField
          label={t('groups.create.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={LIMITS.groupName}
          error={fields.name}
          autoComplete="off"
        />
        <IconPicker value={icon} onChange={setIcon} name="edit-group-icon" />
        <FormError message={error} />
        <button
          type="submit"
          className="btn btn--primary"
          style={{ alignSelf: 'flex-start' }}
          disabled={update.isPending || (name === g.name && icon === g.icon)}
        >
          {update.isPending && <Spinner />}
          {t('common.save')}
        </button>
      </form>
      <div className="list-card">
        <div className="list-card__row">
          <div className="check" style={{ alignItems: 'center', flex: 1 }}>
            <input
              id="gs-members-invite"
              type="checkbox"
              checked={g.membersCanInvite}
              aria-describedby="gs-invite-hint"
              onChange={(e) =>
                update.mutate(
                  { membersCanInvite: e.target.checked },
                  {
                    onSuccess: () => toast(t('groupSettings.saved')),
                    onError: (err) => toast(errorMessage(err, t), { tone: 'error' }),
                  },
                )
              }
            />
            <span className="list-card__label">
              <label htmlFor="gs-members-invite" style={{ fontWeight: 500 }}>
                {t('groupSettings.membersCanInvite')}
              </label>
              <span id="gs-invite-hint" className="meta">
                {t('groupSettings.membersCanInviteHint')}
              </span>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function MembersSection({ g, meId }: { g: GroupDto; meId: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const members = useMembers(g.id);
  const changeRole = useChangeRole(g.id);
  const remove = useRemoveMember(g.id);
  const [removing, setRemoving] = useState<GroupMemberDto | null>(null);
  const [reporting, setReporting] = useState<GroupMemberDto | null>(null);
  const admin = g.permissions.manage;

  return (
    <section className="settings-section" aria-labelledby="gs-members">
      <h2 id="gs-members" className="section-title">
        {t('groupSettings.members')} <span className="meta">({g.memberCount})</span>
      </h2>
      {members.isPending ? (
        <LoadingList rows={3} />
      ) : members.isError ? (
        <ErrorState
          message={errorMessage(members.error, t)}
          onRetry={() => void members.refetch()}
        />
      ) : (
        <ul className="list-card" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {members.data.map((m) => {
            const self = m.id === meId;
            return (
              <li key={m.id} className="list-card__row">
                <span className="row" style={{ flexWrap: 'nowrap', minInlineSize: 0 }}>
                  <MiniAvatar person={m} size={40} />
                  <span className="list-card__label">
                    <span style={{ fontWeight: 500 }}>
                      {m.name}
                      {self && ` (${t('groups.you')})`}
                    </span>
                    <span className="meta">
                      {m.role === 'admin' ? t('groups.admin') : t('groups.member')}
                    </span>
                  </span>
                </span>
                <span className="row">
                  {admin && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--small"
                      disabled={changeRole.isPending}
                      onClick={() =>
                        changeRole.mutate(
                          { userId: m.id, role: m.role === 'admin' ? 'member' : 'admin' },
                          {
                            onSuccess: () => toast(t('groupSettings.roleChanged')),
                            onError: (err) => toast(errorMessage(err, t), { tone: 'error' }),
                          },
                        )
                      }
                    >
                      {m.role === 'admin'
                        ? t('groupSettings.makeMember')
                        : t('groupSettings.makeAdmin')}
                      <span className="visually-hidden">: {m.name}</span>
                    </button>
                  )}
                  {admin && !self && (
                    <button
                      type="button"
                      className="btn btn--danger-ghost btn--small"
                      onClick={() => setRemoving(m)}
                    >
                      {t('groupSettings.remove')}
                      <span className="visually-hidden">: {m.name}</span>
                    </button>
                  )}
                  {!self && (
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={t('report.title.user', { name: m.name })}
                      onClick={() => setReporting(m)}
                    >
                      <Icon name="flag" size={18} />
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <Dialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={t('groupSettings.removeTitle', { name: removing?.name ?? '' })}
        role="alertdialog"
      >
        <p className="muted">{t('groupSettings.removeBody')}</p>
        <div className="modal__actions">
          <button
            type="button"
            className="btn btn--danger btn--block"
            disabled={remove.isPending}
            onClick={async () => {
              if (!removing) return;
              try {
                await remove.mutateAsync(removing.id);
                toast(t('groupSettings.removed', { name: removing.name }));
                setRemoving(null);
              } catch (err) {
                toast(errorMessage(err, t), { tone: 'error' });
              }
            }}
          >
            {remove.isPending && <Spinner />}
            {t('groupSettings.remove')}
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--block"
            onClick={() => setRemoving(null)}
          >
            {t('common.cancel')}
          </button>
        </div>
      </Dialog>
      {reporting && (
        <ReportDialog
          open
          onClose={() => setReporting(null)}
          target={{ type: 'user', id: reporting.id, label: reporting.name, groupId: g.id }}
        />
      )}
    </section>
  );
}

function InvitesSection({ g, tz }: { g: GroupDto; tz: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const invites = useInvites(g.id, g.permissions.invite);
  const revoke = useRevokeInvite(g.id);
  if (!g.permissions.invite) return null;
  return (
    <section className="settings-section" aria-labelledby="gs-invites">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 id="gs-invites" className="section-title">
          {t('groupSettings.invites')}
        </h2>
        <Link
          to="/groups/$id"
          params={{ id: g.id }}
          search={{ invite: '1' }}
          className="btn btn--secondary btn--small"
        >
          <Icon name="userPlus" size={18} />
          {t('groups.invite')}
        </Link>
      </div>
      {invites.isPending ? (
        <LoadingList rows={2} />
      ) : invites.isError ? (
        <ErrorState message={errorMessage(invites.error, t)} />
      ) : invites.data.length === 0 ? (
        <p className="muted">{t('groupSettings.noInvites')}</p>
      ) : (
        <ul className="list-card" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {invites.data.map((inv) => (
            <li key={inv.id} className="list-card__row">
              <span className="list-card__label">
                <span style={{ fontWeight: 500 }}>
                  {inv.channel === 'link'
                    ? `${t('groupSettings.inviteLink')} · ${prettyCode(inv.code)}`
                    : inv.channel === 'email'
                      ? t('groupSettings.inviteEmail', { target: inv.target ?? '' })
                      : t('groupSettings.invitePhone', { target: inv.target ?? '' })}
                </span>
                <span className="meta">
                  {t('groupSettings.inviteUses', {
                    used: inv.useCount,
                    max: inv.maxUses,
                    date: formatDateTime(inv.expiresAt, tz, intlLocale()),
                  })}
                </span>
              </span>
              <span className="row">
                {inv.channel === 'link' && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--small"
                    onClick={async () =>
                      toast(
                        (await copyText(inviteLink(inv.code)))
                          ? t('invite.copied')
                          : t('invite.copyFailed'),
                      )
                    }
                  >
                    <Icon name="copy" size={18} />
                    {t('invite.copyLink')}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn--danger-ghost btn--small"
                  disabled={revoke.isPending}
                  onClick={() =>
                    revoke.mutate(inv.id, {
                      onSuccess: () => toast(t('groupSettings.revoked')),
                      onError: (err) => toast(errorMessage(err, t), { tone: 'error' }),
                    })
                  }
                >
                  {t('groupSettings.revoke')}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DangerSection({ g, meId }: { g: GroupDto; meId: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const leave = useRemoveMember(g.id);
  const remove = useDeleteGroup(g.id);
  const [confirm, setConfirm] = useState<'leave' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    try {
      if (confirm === 'leave') {
        await leave.mutateAsync(meId);
        toast(t('groupSettings.left', { name: g.name }));
      } else {
        await remove.mutateAsync();
        toast(t('groupSettings.deleted'));
      }
      setConfirm(null);
      await navigate({ to: '/groups', replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'last_admin') {
        const only = (err.details as { onlyMember?: boolean } | undefined)?.onlyMember;
        setError(only ? t('groupSettings.onlyMember') : t('groupSettings.lastAdmin'));
      } else setError(errorMessage(err, t));
    }
  }

  return (
    <section className="settings-section" aria-labelledby="gs-danger">
      <h2 id="gs-danger" className="section-title">
        {t('groupSettings.danger')}
      </h2>
      <div className="row">
        <button type="button" className="btn btn--secondary" onClick={() => setConfirm('leave')}>
          <Icon name="logout" size={18} />
          {t('groupSettings.leave')}
        </button>
        {g.permissions.manage && (
          <button
            type="button"
            className="btn btn--danger-ghost"
            onClick={() => setConfirm('delete')}
          >
            <Icon name="trash" size={18} />
            {t('groupSettings.delete')}
          </button>
        )}
      </div>
      <Dialog
        open={!!confirm}
        onClose={() => {
          setConfirm(null);
          setError(null);
        }}
        title={
          confirm === 'delete'
            ? t('groupSettings.deleteTitle', { name: g.name })
            : t('groupSettings.leaveTitle', { name: g.name })
        }
        role="alertdialog"
      >
        <p className="muted">
          {confirm === 'delete' ? t('groupSettings.deleteBody') : t('groupSettings.leaveBody')}
        </p>
        <FormError message={error} />
        <div className="modal__actions">
          <button
            type="button"
            className="btn btn--danger btn--block"
            disabled={leave.isPending || remove.isPending}
            onClick={run}
          >
            {(leave.isPending || remove.isPending) && <Spinner />}
            {confirm === 'delete' ? t('groupSettings.delete') : t('groupSettings.leave')}
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--block"
            onClick={() => {
              setConfirm(null);
              setError(null);
            }}
          >
            {t('common.cancel')}
          </button>
        </div>
      </Dialog>
    </section>
  );
}

export function GroupSettingsPage() {
  const { t } = useTranslation();
  const { id } = useParams({ strict: false }) as { id: string };
  const me = useMe();
  const group = useGroup(id);
  const tz = me.data?.timeZone ?? 'Asia/Kolkata';
  return (
    <main id="main" className="page page--narrow">
      <Link
        to="/groups/$id"
        params={{ id }}
        className="btn btn--ghost btn--small"
        style={{ alignSelf: 'flex-start', paddingInline: 4 }}
      >
        <Icon name="chevronLeft" size={20} />
        {group.data?.name ?? t('common.back')}
      </Link>
      <h1 className="screen-title">{t('groupSettings.title')}</h1>
      {group.isPending ? (
        <LoadingList rows={4} />
      ) : group.isError ? (
        <ErrorState message={t('groups.notFound')} />
      ) : (
        <>
          {group.data.permissions.manage && (
            <DetailsSection key={group.data.name + group.data.icon} g={group.data} />
          )}
          <MembersSection g={group.data} meId={me.data?.id ?? ''} />
          <InvitesSection g={group.data} tz={tz} />
          <DangerSection g={group.data} meId={me.data?.id ?? ''} />
        </>
      )}
    </main>
  );
}
