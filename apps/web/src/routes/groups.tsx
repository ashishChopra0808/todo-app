import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GroupDto, TaskDto } from '@todo/shared';
import { ApiError } from '../api/client';
import { useGroup, useGroups, useMe, useTaskList } from '../api/queries';
import { AvatarStack, FilterChips, GroupIcon } from '../components/GroupBits';
import { Icon } from '../components/Icon';
import { InviteDialog } from '../components/InviteDialog';
import { ReportDialog } from '../components/ReportDialog';
import { Select } from '../components/Select';
import { NewGroupDialog } from '../components/NewGroupDialog';
import { EmptyState, ErrorState, LoadingList } from '../components/States';
import { TaskRow } from '../components/TaskBits';
import { Workspace } from '../components/Workspace';
import { errorMessage } from '../lib/errors';
import { JoinWithCode } from './join';

function GroupCard({ g }: { g: GroupDto }) {
  const { t } = useTranslation();
  return (
    <li>
      <Link to="/groups/$id" params={{ id: g.id }} className="group-card">
        <GroupIcon group={g} size="lg" />
        <span className="group-card__body">
          <span className="group-card__name">{g.name}</span>
          <span className="meta">
            {t('groups.members', { count: g.memberCount })} ·{' '}
            {t('groups.openTasks', { count: g.openTaskCount })}
            {g.role === 'admin' && ` · ${t('groups.admin')}`}
          </span>
        </span>
        <AvatarStack people={g.preview} total={g.memberCount} />
        <Icon name="chevronRight" size={20} className="group-card__chevron" />
      </Link>
    </li>
  );
}

export function GroupsPage() {
  const { t } = useTranslation();
  const groups = useGroups();
  const [creating, setCreating] = useState(false);
  return (
    <main id="main" className="page">
      <header className="page-header">
        <h1 className="screen-title">{t('groups.title')}</h1>
        {!!groups.data?.length && (
          <button
            type="button"
            className="btn btn--secondary btn--small"
            onClick={() => setCreating(true)}
          >
            <Icon name="plus" size={18} />
            {t('groups.new')}
          </button>
        )}
      </header>
      {groups.isPending ? (
        <LoadingList rows={3} />
      ) : groups.isError ? (
        <ErrorState message={errorMessage(groups.error, t)} onRetry={() => void groups.refetch()} />
      ) : groups.data.length === 0 ? (
        <EmptyState
          icon="users"
          title={t('groups.empty.title')}
          body={t('groups.empty.body')}
          action={
            <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
              {t('groups.empty.action')}
            </button>
          }
        />
      ) : (
        <ul className="group-list">
          {groups.data.map((g) => (
            <GroupCard key={g.id} g={g} />
          ))}
        </ul>
      )}
      {!groups.isPending && <JoinWithCode />}
      <NewGroupDialog open={creating} onClose={() => setCreating(false)} />
    </main>
  );
}

type Who = 'all' | 'mine' | 'unassigned';

function Section({
  id,
  title,
  items,
  tz,
  meId,
}: {
  id: string;
  title: string;
  items: TaskDto[];
  tz: string;
  meId: string;
}) {
  if (!items.length) return null;
  return (
    <section className="stack" aria-labelledby={id}>
      <h2 id={id} className="section-title">
        {title} <span className="meta">({items.length})</span>
      </h2>
      <ul className="task-list">
        {items.map((task) => (
          <TaskRow key={task.id} task={task} tz={tz} hideGroup meId={meId} />
        ))}
      </ul>
    </section>
  );
}

export interface GroupSearch {
  who?: Who;
  done?: string;
  invite?: string;
  task?: string;
}

export function GroupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams({ strict: false }) as { id: string };
  const search = useSearch({ strict: false }) as GroupSearch;
  const me = useMe();
  const tz = me.data?.timeZone ?? 'Asia/Kolkata';
  const meId = me.data?.id ?? '';
  const group = useGroup(id);
  const groups = useGroups();
  const who: Who = search.who ?? 'all';
  const showDone = search.done === '1';
  const [reporting, setReporting] = useState(false);
  const assignee = who === 'mine' ? 'me' : who === 'unassigned' ? 'none' : undefined;
  const open = useTaskList({ view: 'all', group: id, assignee, limit: 100 });
  const done = useTaskList({ view: 'completed', group: id, assignee, limit: 50 });
  const setSearch = (patch: Partial<GroupSearch>) =>
    void navigate({
      to: '/groups/$id',
      params: { id },
      search: (s: GroupSearch) => ({ ...s, ...patch }),
      replace: true,
    });

  if (group.isPending)
    return (
      <main id="main" className="page">
        <LoadingList rows={4} />
      </main>
    );
  if (group.isError) {
    const missing = group.error instanceof ApiError && group.error.status === 404;
    return (
      <main id="main" className="page">
        <Link
          to="/groups"
          className="btn btn--ghost btn--small"
          style={{ alignSelf: 'flex-start' }}
        >
          <Icon name="chevronLeft" size={20} />
          {t('groups.title')}
        </Link>
        <ErrorState
          message={missing ? t('groups.notFound') : errorMessage(group.error, t)}
          onRetry={missing ? undefined : () => void group.refetch()}
        />
      </main>
    );
  }
  const g = group.data;
  const items = open.data?.items ?? [];
  const todo = items.filter((x) => x.status === 'todo');
  const inProgress = items.filter((x) => x.status === 'in_progress');
  const doneItems = done.data?.items ?? [];

  return (
    <Workspace>
      <main id="main" className="page">
        <header className="page-header" style={{ alignItems: 'center' }}>
          <div className="row" style={{ flexWrap: 'nowrap', minInlineSize: 0, gap: 12 }}>
            <GroupIcon group={g} size="lg" />
            {groups.data && groups.data.length > 1 ? (
              <div className="group-switcher">
                <h1 className="visually-hidden">{g.name}</h1>
                <Select
                  label={t('groups.switcher')}
                  hideLabel
                  variant="pill"
                  className="select--title"
                  value={g.id}
                  onChange={(next) => void navigate({ to: '/groups/$id', params: { id: next } })}
                  options={groups.data.map((x) => ({
                    value: x.id,
                    label: `${x.icon ? `${x.icon} ` : ''}${x.name}`,
                  }))}
                />
              </div>
            ) : (
              <h1 className="screen-title" style={{ overflowWrap: 'anywhere' }}>
                {g.name}
              </h1>
            )}
          </div>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <Link
              to="/tasks/new"
              search={{ group: id }}
              className="btn btn--primary btn--small desktop-only"
            >
              <Icon name="plus" size={18} />
              {t('groups.addTask')}
            </Link>
            <Link
              to="/groups/$id/settings"
              params={{ id }}
              className="icon-btn"
              aria-label={t('groups.settings')}
            >
              <Icon name="settings" size={22} />
            </Link>
          </div>
        </header>

        <section className="members-strip card" aria-label={t('groups.membersLabel')}>
          <Link to="/groups/$id/settings" params={{ id }} className="members-strip__people">
            <AvatarStack people={g.preview} total={g.memberCount} />
            <span className="meta">{t('groups.members', { count: g.memberCount })}</span>
          </Link>
          {g.permissions.invite && (
            <button
              type="button"
              className="btn btn--secondary btn--small"
              onClick={() => setSearch({ invite: '1' })}
            >
              <Icon name="userPlus" size={18} />
              {t('groups.invite')}
            </button>
          )}
        </section>

        <FilterChips<Who>
          legend={t('groups.chips.label')}
          name="group-who"
          value={who}
          onChange={(v) => setSearch({ who: v === 'all' ? undefined : v })}
          options={[
            { value: 'all', label: t('groups.chips.all') },
            { value: 'mine', label: t('groups.chips.mine') },
            { value: 'unassigned', label: t('groups.chips.unassigned') },
          ]}
        />

        <div aria-live="polite" aria-busy={open.isFetching} className="stack-lg">
          {open.isPending ? (
            <LoadingList rows={4} />
          ) : open.isError ? (
            <ErrorState message={errorMessage(open.error, t)} onRetry={() => void open.refetch()} />
          ) : items.length === 0 && !showDone ? (
            <EmptyState
              title={who === 'all' ? t('groups.emptyTasks') : t('groups.emptyFiltered')}
              action={
                <Link to="/tasks/new" search={{ group: id }} className="btn btn--primary">
                  {t('groups.addTask')}
                </Link>
              }
            />
          ) : (
            <>
              <Section
                id="g-todo"
                title={t('groups.sections.todo')}
                items={todo}
                tz={tz}
                meId={meId}
              />
              <Section
                id="g-progress"
                title={t('groups.sections.inProgress')}
                items={inProgress}
                tz={tz}
                meId={meId}
              />
            </>
          )}
          <button
            type="button"
            className="btn btn--ghost btn--small"
            style={{ alignSelf: 'flex-start' }}
            aria-expanded={showDone}
            onClick={() => setSearch({ done: showDone ? undefined : '1' })}
          >
            <Icon name={showDone ? 'chevronDown' : 'chevronRight'} size={18} />
            {showDone ? t('groups.hideDone') : t('groups.showDone', { count: doneItems.length })}
          </button>
          {showDone &&
            (done.isPending ? (
              <LoadingList rows={2} />
            ) : (
              <Section
                id="g-done"
                title={t('groups.sections.done')}
                items={doneItems}
                tz={tz}
                meId={meId}
              />
            ))}
        </div>

        <div className="row">
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => setReporting(true)}
          >
            <Icon name="flag" size={18} />
            {t('groupSettings.report')}
          </button>
        </div>
      </main>
      <div className="fab-row">
        <Link to="/tasks/new" search={{ group: id }} className="btn btn--primary btn--fab">
          <Icon name="plus" />
          {t('groups.addTask')}
        </Link>
      </div>
      <InviteDialog
        group={g}
        open={search.invite === '1' && g.permissions.invite}
        onClose={() => setSearch({ invite: undefined })}
      />
      <ReportDialog
        open={reporting}
        onClose={() => setReporting(false)}
        target={{ type: 'group', id: g.id, label: g.name }}
      />
    </Workspace>
  );
}
