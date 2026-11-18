import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import type {
  ActivityDto,
  MeDto,
  ProfileUpdateInput,
  SessionDto,
  TaskCountsDto,
  TaskCreateInput,
  TaskDto,
  TaskListResponse,
  TaskUpdateInput,
} from '@todo/shared';
import { ApiError, del, get, patch, post } from './client';

export const keys = {
  me: ['me'] as const,
  tasks: ['tasks'] as const,
  list: (params: Record<string, unknown>) => ['tasks', 'list', params] as const,
  counts: ['tasks', 'counts'] as const,
  task: (id: string) => ['tasks', 'one', id] as const,
  activity: (id: string) => ['tasks', 'activity', id] as const,
  sessions: ['sessions'] as const,
};

export const meQuery = {
  queryKey: keys.me,
  queryFn: () => get<MeDto>('/api/v1/me'),
  staleTime: 60_000,
  retry: (n: number, err: unknown) => !(err instanceof ApiError && err.status < 500) && n < 2,
};

export function useMe() {
  return useQuery(meQuery);
}

export function toQueryString(
  params: Record<string, string | string[] | number | undefined | null>,
) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    sp.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  return sp.toString();
}

export interface ListParams {
  view: 'today' | 'mine' | 'overdue' | 'completed';
  q?: string;
  status?: string[];
  priority?: string[];
  dueFrom?: string;
  dueTo?: string;
  limit?: number;
  cursor?: string;
}

export function useTaskList(params: ListParams) {
  return useQuery({
    queryKey: keys.list(params as unknown as Record<string, unknown>),
    queryFn: () => get<TaskListResponse>(`/api/v1/tasks?${toQueryString({ ...params })}`),
    placeholderData: keepPreviousData,
  });
}

export function useTaskCounts() {
  return useQuery({
    queryKey: keys.counts,
    queryFn: () => get<TaskCountsDto>('/api/v1/tasks/counts'),
  });
}

export function useTask(id: string) {
  return useQuery({
    queryKey: keys.task(id),
    queryFn: () => get<TaskDto>(`/api/v1/tasks/${id}`),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  });
}

export function useActivity(id: string) {
  return useQuery({
    queryKey: keys.activity(id),
    queryFn: () => get<ActivityDto[]>(`/api/v1/tasks/${id}/activity`),
  });
}

function patchTaskInCaches(qc: QueryClient, next: TaskDto) {
  qc.setQueryData(keys.task(next.id), next);
  qc.setQueriesData<TaskListResponse>({ queryKey: ['tasks', 'list'] }, (old) =>
    old ? { ...old, items: old.items.map((t) => (t.id === next.id ? next : t)) } : old,
  );
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TaskCreateInput) =>
      post<TaskDto>('/api/v1/tasks', { id: crypto.randomUUID(), ...input }),
    onSuccess: (task) => {
      qc.setQueryData(keys.task(task.id), task);
      void qc.invalidateQueries({ queryKey: keys.tasks });
    },
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: TaskUpdateInput & { id: string }) =>
      patch<TaskDto>(`/api/v1/tasks/${id}`, input),
    onSuccess: (task) => {
      patchTaskInCaches(qc, task);
      void qc.invalidateQueries({ queryKey: keys.counts });
      void qc.invalidateQueries({ queryKey: keys.activity(task.id) });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'conflict' && err.details)
        patchTaskInCaches(qc, err.details as TaskDto);
    },
  });
}

/** Optimistic status change: the tick appears at once and rolls back if the server refuses. */
export function useToggleStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (task: TaskDto) =>
      patch<TaskDto>(`/api/v1/tasks/${task.id}`, {
        version: task.version,
        status: task.status === 'done' ? 'todo' : 'done',
      }),
    onMutate: async (task) => {
      await qc.cancelQueries({ queryKey: keys.tasks });
      const snapshot = qc.getQueriesData({ queryKey: keys.tasks });
      const optimistic: TaskDto = {
        ...task,
        status: task.status === 'done' ? 'todo' : 'done',
        completedAt: task.status === 'done' ? null : new Date().toISOString(),
      };
      patchTaskInCaches(qc, optimistic);
      return { snapshot };
    },
    onError: (err, _task, ctx) => {
      ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data));
      if (err instanceof ApiError && err.code === 'conflict' && err.details)
        patchTaskInCaches(qc, err.details as TaskDto);
    },
    onSuccess: (task) => patchTaskInCaches(qc, task),
    onSettled: (task) => {
      void qc.invalidateQueries({ queryKey: keys.counts });
      if (task) void qc.invalidateQueries({ queryKey: keys.activity(task.id) });
    },
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del<void>(`/api/v1/tasks/${id}`),
    onSuccess: (_r, id) => {
      qc.removeQueries({ queryKey: keys.task(id) });
      qc.setQueriesData<TaskListResponse>({ queryKey: ['tasks', 'list'] }, (old) =>
        old ? { ...old, items: old.items.filter((t) => t.id !== id) } : old,
      );
      void qc.invalidateQueries({ queryKey: keys.tasks });
    },
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProfileUpdateInput) => patch<MeDto>('/api/v1/me', input),
    // Optimistic: language/theme/time zone controls reflect the choice immediately.
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: keys.me });
      const previous = qc.getQueryData<MeDto>(keys.me);
      if (previous) qc.setQueryData<MeDto>(keys.me, { ...previous, ...(input as Partial<MeDto>) });
      return { previous };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(keys.me, ctx.previous);
    },
    onSuccess: (me) => {
      qc.setQueryData(keys.me, me);
      void qc.invalidateQueries({ queryKey: keys.tasks });
    },
  });
}

export function useSessions() {
  return useQuery({
    queryKey: keys.sessions,
    queryFn: () => get<SessionDto[]>('/api/v1/me/sessions'),
  });
}
