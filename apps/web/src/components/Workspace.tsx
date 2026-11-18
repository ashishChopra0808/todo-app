import { useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { TaskDetail } from '../routes/task-detail';
import { WIDE_QUERY, useMediaQuery } from '../lib/useMediaQuery';

/**
 * List screens (Today, Tasks). On wide screens the selected task (?task=<id>) opens in a panel
 * beside the list; Escape or the close button closes it and focus returns to the list row.
 */
export function Workspace({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const wide = useMediaQuery(WIDE_QUERY);
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { task?: string };
  const selected = wide ? search.task : undefined;

  const close = () => {
    const id = search.task;
    void navigate({
      to: '.',
      search: (s: Record<string, unknown>) => ({ ...s, task: undefined }),
      replace: true,
    }).then(() => {
      if (id) document.querySelector<HTMLElement>(`[data-task-link="${CSS.escape(id)}"]`)?.focus();
    });
  };

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.modal-overlay')) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // re-bind each render so `close` sees the current search

  return (
    <div className={selected ? 'workspace workspace--open' : 'workspace'}>
      {children}
      {selected && (
        <aside className="task-panel" aria-label={t('task.panel.label')}>
          <TaskDetail
            key={selected}
            id={selected}
            variant="panel"
            onClose={close}
            onDeleted={close}
          />
        </aside>
      )}
    </div>
  );
}
