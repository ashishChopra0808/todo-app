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

export const splitCsv = (v?: string) => (v ? v.split(',').filter(Boolean) : []);

/** List parameters for a given URL search (used by the screen and by the route loader). */
export function tasksParams(search: TasksSearch) {
  return {
    view: search.tab ?? 'mine',
    q: search.q,
    status: splitCsv(search.status),
    priority: splitCsv(search.priority),
    dueFrom: search.dueFrom,
    dueTo: search.dueTo,
    limit: 30,
  } as const;
}
