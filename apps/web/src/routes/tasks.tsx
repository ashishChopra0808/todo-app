import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TASK_PRIORITIES, TASK_STATUSES, type TaskListResponse } from '@todo/shared';
import { get } from '../api/client';
import { keys, toQueryString, useMe } from '../api/queries';
import { Icon } from '../components/Icon';
import { Workspace } from '../components/Workspace';
import { EmptyState, ErrorState, LoadingList, Spinner } from '../components/States';
import { TaskRow } from '../components/TaskBits';
import { errorMessage } from '../lib/errors';

export interface TasksSearch {
  tab?: 'mine' | 'overdue' | 'completed';
  q?: string;
  status?: string;
  priority?: string;
  dueFrom?: string;
  dueTo?: string;
  focus?: string;
  task?: string;
}

const splitCsv = (v?: string) => (v ? v.split(',').filter(Boolean) : []);

export function TasksPage() {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: '/tasks' });
  const search = useSearch({ strict: false }) as TasksSearch;
  const me = useMe();
  const tz = me.data?.timeZone ?? 'Asia/Kolkata';
  const tab = search.tab ?? 'mine';
  const [q, setQ] = useState(search.q ?? '');
  const [showFilters, setShowFilters] = useState(
    !!(search.status || search.priority || search.dueFrom || search.dueTo),
  );
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (search.focus === 'search') searchRef.current?.focus();
  }, [search.focus]);

  // Debounce typing into the URL (the URL is the source of truth for filters, so they survive reloads and back).
  useEffect(() => {
    const h = setTimeout(() => {
      if ((search.q ?? '') !== q)
        void navigate({
          search: (s: TasksSearch) => ({ ...s, q: q || undefined, focus: undefined }),
          replace: true,
        });
    }, 300);
    return () => clearTimeout(h);
  }, [q, search.q, navigate]);

  const status = splitCsv(search.status);
  const priority = splitCsv(search.priority);
  const params = {
    view: tab,
    q: search.q,
    status,
    priority,
    dueFrom: search.dueFrom,
    dueTo: search.dueTo,
    limit: 30,
  };
  const list = useInfiniteQuery({
    queryKey: keys.list({ ...params, infinite: true }),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      get<TaskListResponse>(`/api/v1/tasks?${toQueryString({ ...params, cursor: pageParam })}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const activeFilters = [
    status.length,
    priority.length,
    search.dueFrom ? 1 : 0,
    search.dueTo ? 1 : 0,
  ].filter(Boolean).length;
  const filtering = !!search.q || activeFilters > 0;

  const toggleIn = (key: 'status' | 'priority', value: string) => {
    const cur = splitCsv(search[key]);
    const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
    void navigate({
      search: (s: TasksSearch) => ({ ...s, [key]: next.length ? next.join(',') : undefined }),
      replace: true,
    });
  };

  const tabs = [
    { id: 'mine', label: t('tasks.tabs.mine') },
    { id: 'overdue', label: t('tasks.tabs.overdue') },
    { id: 'completed', label: t('tasks.tabs.completed') },
  ] as const;

  return (
    <Workspace>
      <main id="main" className="page">
        <header className="page-header">
          <h1 className="screen-title">{t('tasks.title')}</h1>
        </header>

        <nav aria-label={t('tasks.tabs.label')} className="tabs">
          {tabs.map((x) => (
            <Link
              key={x.id}
              to="/tasks"
              search={(s: TasksSearch) => ({ ...s, tab: x.id === 'mine' ? undefined : x.id })}
              className="tab"
              aria-current={tab === x.id ? 'page' : undefined}
            >
              {x.label}
            </Link>
          ))}
        </nav>

        <div className="stack">
          <div className="search" role="search">
            <label htmlFor="task-search" className="visually-hidden">
              {t('tasks.search.label')}
            </label>
            <Icon name="search" size={20} />
            <input
              id="task-search"
              ref={searchRef}
              type="search"
              className="input"
              placeholder={t('tasks.search.placeholder')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              maxLength={100}
              enterKeyHint="search"
            />
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              aria-expanded={showFilters}
              aria-controls="filters"
              onClick={() => setShowFilters((v) => !v)}
            >
              <Icon name="filter" size={18} />
              {activeFilters
                ? t('tasks.filters.active', { count: activeFilters })
                : t('tasks.filters.toggle')}
            </button>
            {activeFilters > 0 && (
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={() =>
                  void navigate({
                    search: (s: TasksSearch) => ({ tab: s.tab, q: s.q }),
                    replace: true,
                  })
                }
              >
                {t('tasks.filters.clear')}
              </button>
            )}
          </div>
          {showFilters && (
            <div id="filters" className="card filters">
              {tab === 'mine' && (
                <fieldset className="fieldset">
                  <legend className="section-title">{t('tasks.filters.status')}</legend>
                  <div className="chips">
                    {TASK_STATUSES.map((s) => (
                      <label key={s} className="chip">
                        <input
                          type="checkbox"
                          checked={status.includes(s)}
                          onChange={() => toggleIn('status', s)}
                        />
                        <span>{t(`task.status.${s}`)}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              <fieldset className="fieldset">
                <legend className="section-title">{t('tasks.filters.priority')}</legend>
                <div className="chips">
                  {TASK_PRIORITIES.map((p) => (
                    <label key={p} className="chip">
                      <input
                        type="checkbox"
                        checked={priority.includes(p)}
                        onChange={() => toggleIn('priority', p)}
                      />
                      <span>
                        <span className={`dot dot--${p}`} aria-hidden="true" />
                        {t(`task.priority.${p}`)}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="filters__dates">
                <div className="field">
                  <label className="field__label" htmlFor="due-from">
                    {t('tasks.filters.dueFrom')}
                  </label>
                  <input
                    id="due-from"
                    type="date"
                    className="input"
                    value={search.dueFrom ?? ''}
                    onChange={(e) =>
                      void navigate({
                        search: (s: TasksSearch) => ({
                          ...s,
                          dueFrom: e.target.value || undefined,
                        }),
                        replace: true,
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="due-to">
                    {t('tasks.filters.dueTo')}
                  </label>
                  <input
                    id="due-to"
                    type="date"
                    className="input"
                    value={search.dueTo ?? ''}
                    onChange={(e) =>
                      void navigate({
                        search: (s: TasksSearch) => ({ ...s, dueTo: e.target.value || undefined }),
                        replace: true,
                      })
                    }
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <section aria-live="polite" aria-busy={list.isFetching}>
          {list.isPending ? (
            <LoadingList rows={5} />
          ) : list.isError ? (
            <ErrorState message={errorMessage(list.error, t)} onRetry={() => void list.refetch()} />
          ) : items.length === 0 ? (
            <EmptyState
              icon={filtering ? 'search' : 'list'}
              title={filtering ? t('tasks.empty.search') : t(`tasks.empty.${tab}`)}
            />
          ) : (
            <div className="stack">
              <p className="visually-hidden">{t('tasks.count', { count: items.length })}</p>
              <ul className="task-list">
                {items.map((task) => (
                  <TaskRow key={task.id} task={task} tz={tz} />
                ))}
              </ul>
              {list.hasNextPage && (
                <button
                  className="btn btn--secondary"
                  onClick={() => void list.fetchNextPage()}
                  disabled={list.isFetchingNextPage}
                >
                  {list.isFetchingNextPage && <Spinner />}
                  {t('tasks.loadMore')}
                </button>
              )}
            </div>
          )}
        </section>
      </main>
    </Workspace>
  );
}
