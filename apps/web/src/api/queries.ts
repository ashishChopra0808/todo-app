import {
  infiniteQueryOptions,
  useInfiniteQuery,
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import type {
  ActivityDto,
  AdminReportDetailDto,
  AdminReportDto,
  CommentDto,
  CommentListResponse,
  GroupCreateInput,
  GroupDto,
  GroupMemberDto,
  GroupRole,
  GroupUpdateInput,
  InviteCreateInput,
  InviteDto,
  InvitePreviewDto,
  MeDto,
  ProfileUpdateInput,
  ReportCreateInput,
  SessionDto,
  TaskCountsDto,
  TaskCreateInput,
  TaskDto,
  TaskListResponse,
  TaskUpdateInput,
  TaskView,
} from '@todo/shared';
import { ApiError, del, get, patch, post } from './client';

export const keys = {
  me: ['me'] as const,
  tasks: ['tasks'] as const,
  list: (params: Record<string, unknown>) => ['tasks', 'list', params] as const,
  counts: ['tasks', 'counts'] as const,
  task: (id: string) => ['tasks', 'one', id] as const,
  activity: (id: string) => ['tasks', 'activity', id] as const,
  comments: (taskId: string) => ['tasks', 'comments', taskId] as const,
  sessions: ['sessions'] as const,
  groups: ['groups'] as const,
  group: (id: string) => ['groups', 'one', id] as const,
  members: (id: string) => ['groups', 'members', id] as const,
  invites: (id: string) => ['groups', 'invites', id] as const,
  invitePreview: (code: string) => ['invite', code] as const,
  admin: ['admin'] as const,
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
  view: TaskView;
  /** A group id, or "personal". */
  group?: string;
  /** A user id, "me" or "none". */
  assignee?: string;
  q?: string;
  status?: string[];
  priority?: string[];
  dueFrom?: string;
  dueTo?: string;
  limit?: number;
  cursor?: string;
}

/** Shared by the screen and its route loader, so the list starts downloading in parallel with the screen's code. */
export const taskListOptions = (params: ListParams) =>
  queryOptions({
    queryKey: keys.list(params as unknown as Record<string, unknown>),
    queryFn: () => get<TaskListResponse>(`/api/v1/tasks?${toQueryString({ ...params })}`),
    placeholderData: keepPreviousData,
  });

export const taskPagesOptions = (params: Omit<ListParams, 'cursor'>) =>
  infiniteQueryOptions({
    queryKey: keys.list({ ...params, infinite: true }),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      get<TaskListResponse>(`/api/v1/tasks?${toQueryString({ ...params, cursor: pageParam })}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

export const countsOptions = queryOptions({
  queryKey: keys.counts,
  queryFn: () => get<TaskCountsDto>('/api/v1/tasks/counts'),
});

export const TODAY_PARAMS: ListParams = { view: 'today', limit: 100 };

export function useTaskList(params: ListParams) {
  return useQuery(taskListOptions(params));
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

type ListCache = TaskListResponse | InfiniteData<TaskListResponse, string | undefined>;

/** Applies a change to every cached task list — plain (Today) and paged (Tasks) alike. */
function updateLists(qc: QueryClient, fn: (items: TaskDto[]) => TaskDto[]) {
  qc.setQueriesData<ListCache>({ queryKey: ['tasks', 'list'] }, (old) => {
    if (!old) return old;
    if ('pages' in old)
      return { ...old, pages: old.pages.map((p) => ({ ...p, items: fn(p.items) })) };
    return { ...old, items: fn(old.items) };
  });
}

function patchTaskInCaches(qc: QueryClient, next: TaskDto) {
  qc.setQueryData(keys.task(next.id), next);
  updateLists(qc, (items) => items.map((t) => (t.id === next.id ? next : t)));
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
      updateLists(qc, (items) => items.filter((t) => t.id !== id));
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

/* ---------- Groups ---------- */

export const groupsOptions = queryOptions({
  queryKey: keys.groups,
  queryFn: () => get<GroupDto[]>('/api/v1/groups'),
  staleTime: 30_000,
});

export function useGroups() {
  return useQuery(groupsOptions);
}

export function useGroup(id: string) {
  return useQuery({
    queryKey: keys.group(id),
    queryFn: () => get<GroupDto>(`/api/v1/groups/${id}`),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  });
}

export function useMembers(id: string | null | undefined) {
  return useQuery({
    queryKey: keys.members(id ?? ''),
    queryFn: () => get<GroupMemberDto[]>(`/api/v1/groups/${id}/members`),
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useInvites(id: string, enabled = true) {
  return useQuery({
    queryKey: keys.invites(id),
    queryFn: () => get<InviteDto[]>(`/api/v1/groups/${id}/invites`),
    enabled,
  });
}

/** After any group change: the group lists, the group itself, and task lists (names, access). */
function refreshGroups(qc: QueryClient, id?: string) {
  void qc.invalidateQueries({ queryKey: keys.groups });
  if (id) void qc.invalidateQueries({ queryKey: keys.group(id) });
}

export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: GroupCreateInput) => post<GroupDto>('/api/v1/groups', input),
    onSuccess: (g) => {
      qc.setQueryData(keys.group(g.id), g);
      refreshGroups(qc);
    },
  });
}

export function useUpdateGroup(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: GroupUpdateInput) => patch<GroupDto>(`/api/v1/groups/${id}`, input),
    onSuccess: (g) => {
      qc.setQueryData(keys.group(id), g);
      refreshGroups(qc);
      void qc.invalidateQueries({ queryKey: keys.tasks });
    },
  });
}

export function useDeleteGroup(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => del<void>(`/api/v1/groups/${id}`),
    onSuccess: () => {
      qc.removeQueries({ queryKey: keys.group(id) });
      refreshGroups(qc);
      void qc.invalidateQueries({ queryKey: keys.tasks });
    },
  });
}

export function useChangeRole(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: GroupRole }) =>
      patch<GroupMemberDto[]>(`/api/v1/groups/${groupId}/members/${userId}`, { role }),
    onSuccess: (members) => {
      qc.setQueryData(keys.members(groupId), members);
      refreshGroups(qc, groupId);
    },
  });
}

export function useRemoveMember(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      del<{ unassignedTasks: number }>(`/api/v1/groups/${groupId}/members/${userId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.members(groupId) });
      refreshGroups(qc, groupId);
      void qc.invalidateQueries({ queryKey: keys.tasks });
    },
  });
}

export function useCreateInvite(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: InviteCreateInput) =>
      post<InviteDto>(`/api/v1/groups/${groupId}/invites`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.invites(groupId) }),
  });
}

export function useRevokeInvite(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) => del<void>(`/api/v1/invites/${inviteId}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.invites(groupId) }),
  });
}

export function useInvitePreview(code: string) {
  return useQuery({
    queryKey: keys.invitePreview(code),
    queryFn: () => get<InvitePreviewDto>(`/api/v1/invites/${encodeURIComponent(code)}`),
    retry: false,
  });
}

export function useAcceptInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) =>
      post<GroupDto>(`/api/v1/invites/${encodeURIComponent(code)}/accept`),
    onSuccess: (g, code) => {
      qc.setQueryData(keys.group(g.id), g);
      qc.removeQueries({ queryKey: keys.invitePreview(code) });
      refreshGroups(qc);
      void qc.invalidateQueries({ queryKey: keys.tasks });
    },
  });
}

/* ---------- Comments ---------- */

export function useComments(taskId: string) {
  return useInfiniteQuery({
    queryKey: keys.comments(taskId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      get<CommentListResponse>(
        `/api/v1/tasks/${taskId}/comments?${toQueryString({ cursor: pageParam, limit: 50 })}`,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

function bumpCommentCount(qc: QueryClient, taskId: string, by: number) {
  const fix = (t: TaskDto) =>
    t.id === taskId ? { ...t, commentCount: Math.max(0, t.commentCount + by) } : t;
  qc.setQueryData<TaskDto>(keys.task(taskId), (old) => (old ? fix(old) : old));
  updateLists(qc, (items) => items.map(fix));
}

export function useAddComment(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      post<CommentDto>(`/api/v1/tasks/${taskId}/comments`, { id: crypto.randomUUID(), body }),
    onSuccess: () => {
      bumpCommentCount(qc, taskId, 1);
      void qc.invalidateQueries({ queryKey: keys.comments(taskId) });
      void qc.invalidateQueries({ queryKey: keys.activity(taskId) });
    },
  });
}

export function useEditComment(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      patch<CommentDto>(`/api/v1/comments/${id}`, { body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.comments(taskId) }),
  });
}

export function useDeleteComment(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del<void>(`/api/v1/comments/${id}`),
    onSuccess: () => {
      bumpCommentCount(qc, taskId, -1);
      void qc.invalidateQueries({ queryKey: keys.comments(taskId) });
    },
  });
}

/* ---------- Reports and owner review ---------- */

export function useReport() {
  return useMutation({
    mutationFn: (input: ReportCreateInput) => post<{ id: string }>('/api/v1/reports', input),
  });
}

export function useIsOwner() {
  return useQuery({
    queryKey: [...keys.admin, 'me'],
    queryFn: () => get<{ owner: true }>('/api/v1/admin/me'),
    retry: false,
    staleTime: Infinity,
  });
}

export function useAdminReports(status: 'open' | 'actioned' | 'dismissed', enabled: boolean) {
  return useQuery({
    queryKey: [...keys.admin, 'reports', status],
    queryFn: () =>
      get<{ items: AdminReportDto[]; nextCursor: string | null }>(
        `/api/v1/admin/reports?status=${status}&limit=100`,
      ),
    enabled,
  });
}

export function useAdminReport(id: string | undefined) {
  return useQuery({
    queryKey: [...keys.admin, 'report', id],
    queryFn: () => get<AdminReportDetailDto>(`/api/v1/admin/reports/${id}`),
    enabled: !!id,
  });
}

export function useResolveReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      action: 'remove' | 'dismiss';
      suspendOwner?: boolean;
      note?: string;
    }) => post<AdminReportDetailDto>(`/api/v1/admin/reports/${id}/resolve`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.admin }),
  });
}

export function useSuspendUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      suspend,
      reason,
    }: {
      userId: string;
      suspend: boolean;
      reason?: string;
    }) =>
      post<void>(
        `/api/v1/admin/users/${userId}/${suspend ? 'suspend' : 'unsuspend'}`,
        suspend ? { reason } : {},
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.admin }),
  });
}
