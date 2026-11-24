import {
  infiniteQueryOptions,
  useInfiniteQuery,
  type QueryKey,
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
  TaskDto,
  TaskListResponse,
  TaskUpdateInput,
  TaskView,
  FileDto,
  NotificationListResponse,
  NotificationPreferencesDto,
  NotificationPreferenceDto,
  SimpleConversationDto,
  SimpleHomeDto,
} from '@todo/shared';
import { OFFLINE, type AddCommentVars, type CreateTaskVars, type SetStatusVars } from './offline';
import { ApiError, del, get, patch, post, put } from './client';

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
  notifications: ['notifications', 'list'] as const,
  unread: ['notifications', 'unread'] as const,
  notificationPrefs: ['notifications', 'prefs'] as const,
  simpleHome: ['simple', 'home'] as const,
  simplePerson: (id: string) => ['simple', 'person', id] as const,
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

/** A task as it will look once saved, so it shows at once (and offline). */
function optimisticTask(qc: QueryClient, v: CreateTaskVars): TaskDto {
  const me = qc.getQueryData<MeDto>(keys.me);
  const group = v.groupId
    ? qc.getQueryData<GroupDto[]>(keys.groups)?.find((g) => g.id === v.groupId)
    : null;
  const now = new Date().toISOString();
  const assigneeId = v.groupId ? (v.assigneeId ?? null) : (me?.id ?? null);
  return {
    id: v.id,
    title: v.title,
    description: v.description ?? null,
    dueAt: v.dueAt ?? null,
    dueHasTime: !!(v.dueAt && v.dueHasTime),
    priority: v.priority ?? 'medium',
    status: v.status ?? 'todo',
    source: v.audioFileId ? 'voice' : 'text',
    groupId: v.groupId ?? null,
    group: group ? { id: group.id, name: group.name, icon: group.icon } : null,
    createdBy: me ? { id: me.id, name: me.name } : null,
    assignee:
      assigneeId === me?.id && me
        ? { id: me.id, name: me.name, avatarUrl: me.avatarUrl ?? null }
        : assigneeId
          ? { id: assigneeId, name: '', avatarUrl: null }
          : null,
    commentCount: 0,
    audio: null,
    completedAt: v.status === 'done' ? now : null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    permissions: {
      edit: true,
      delete: true,
      changeStatus: true,
      assign: !!v.groupId,
      move: true,
      comment: true,
      report: false,
    },
  };
}

/**
 * Creates a task. Pass your own `id` (crypto.randomUUID()): offline, the task appears at once
 * marked "waiting to sync" and is sent when the connection returns.
 */
export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation<TaskDto, Error, CreateTaskVars, { optimistic: TaskDto }>({
    mutationKey: OFFLINE.createTask,
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ['tasks', 'list'] });
      const optimistic = optimisticTask(qc, v);
      qc.setQueryData(keys.task(v.id), optimistic);
      updateLists(qc, (items) =>
        items.some((t) => t.id === v.id) ? items : [optimistic, ...items],
      );
      return { optimistic };
    },
    onError: (_e, v) => {
      qc.removeQueries({ queryKey: keys.task(v.id) });
      updateLists(qc, (items) => items.filter((t) => t.id !== v.id));
    },
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

/**
 * Optimistic status change: the tick appears at once and rolls back if the server refuses.
 * Offline, it waits (marked "waiting to sync") and is sent when the connection returns.
 */
export function useToggleStatus() {
  const qc = useQueryClient();
  const m = useMutation<TaskDto, Error, SetStatusVars, { snapshot: Array<[QueryKey, unknown]> }>({
    mutationKey: OFFLINE.setStatus,
    onMutate: async ({ task, status }) => {
      await qc.cancelQueries({ queryKey: keys.tasks });
      const snapshot = qc.getQueriesData({ queryKey: keys.tasks });
      patchTaskInCaches(qc, {
        ...task,
        status,
        completedAt: status === 'done' ? new Date().toISOString() : null,
      });
      return { snapshot };
    },
    onError: (err, _v, ctx) => {
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
  return {
    /** Busy only while actually sending (a change waiting offline doesn't block the button). */
    isPending: m.isPending && !m.isPaused,
    mutate: (
      task: TaskDto,
      opts?: Parameters<typeof m.mutate>[1],
      status: TaskDto['status'] = task.status === 'done' ? 'todo' : 'done',
    ) => m.mutate({ task, status }, opts),
  };
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

/** Text replies go through the offline queue; voice replies need a connection (upload). */
export function useAddComment(taskId: string) {
  const qc = useQueryClient();
  return useMutation<unknown, Error, AddCommentVars>({
    mutationKey: OFFLINE.addComment,
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: keys.comments(taskId) });
      const me = qc.getQueryData<MeDto>(keys.me);
      const optimistic: CommentDto = {
        id: v.id,
        taskId,
        author: me ? { id: me.id, name: me.name, avatarUrl: me.avatarUrl ?? null } : null,
        body: v.body,
        audio: null,
        removed: false,
        editedAt: null,
        createdAt: new Date().toISOString(),
        permissions: { edit: false, delete: false, report: false },
      };
      qc.setQueryData<InfiniteData<CommentListResponse>>(keys.comments(taskId), (old) => {
        if (!old)
          return { pages: [{ items: [optimistic], nextCursor: null }], pageParams: [undefined] };
        const pages = [...old.pages];
        const last = pages[pages.length - 1]!;
        pages[pages.length - 1] = { ...last, items: [...last.items, optimistic] };
        return { ...old, pages };
      });
      bumpCommentCount(qc, taskId, 1);
    },
    onError: () => {
      bumpCommentCount(qc, taskId, -1);
      void qc.invalidateQueries({ queryKey: keys.comments(taskId) });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.comments(taskId) });
      void qc.invalidateQueries({ queryKey: keys.activity(taskId) });
    },
  });
}

export function useAddVoiceComment(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rec: Recording) => {
      const file = await uploadAudio(rec, 'comment_audio');
      return post<CommentDto>(`/api/v1/tasks/${taskId}/comments`, {
        id: crypto.randomUUID(),
        audioFileId: file.id,
      });
    },
    onSuccess: () => {
      bumpCommentCount(qc, taskId, 1);
      void qc.invalidateQueries({ queryKey: keys.comments(taskId) });
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

/* ---------- Voice recordings ---------- */

export interface Recording {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

export async function uploadAudio(rec: Recording, kind: 'task_audio' | 'comment_audio') {
  const form = new FormData();
  form.append('kind', kind);
  form.append('durationMs', String(Math.round(rec.durationMs)));
  const ext = rec.mimeType.includes('mp4') ? 'm4a' : rec.mimeType.includes('ogg') ? 'ogg' : 'webm';
  form.append('file', rec.blob, `recording.${ext}`);
  return post<FileDto>('/api/v1/files', form);
}

/* ---------- Notifications ---------- */

export function useNotifications() {
  return useInfiniteQuery({
    queryKey: keys.notifications,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      get<NotificationListResponse>(
        `/api/v1/notifications?${toQueryString({ cursor: pageParam, limit: 30 })}`,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** The bell's badge. Refreshed every minute and when the app comes back to the front. */
export function useUnreadCount(enabled = true) {
  return useQuery({
    queryKey: keys.unread,
    queryFn: () => get<{ count: number }>('/api/v1/notifications/unread-count'),
    refetchInterval: 60_000,
    enabled,
  });
}

export function useMarkNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string | 'all') =>
      post<void>(
        id === 'all' ? '/api/v1/notifications/read-all' : `/api/v1/notifications/${id}/read`,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.notifications });
      void qc.invalidateQueries({ queryKey: keys.unread });
    },
  });
}

export function useNotificationPrefs() {
  return useQuery({
    queryKey: keys.notificationPrefs,
    queryFn: () => get<NotificationPreferencesDto>('/api/v1/me/notification-preferences'),
  });
}

/** Switches one type/channel; the box changes at once and rolls back if saving fails. */
export function useSetNotificationPref() {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (p: NotificationPreferenceDto) =>
      put<NotificationPreferencesDto>('/api/v1/me/notification-preferences', { preferences: [p] }),
    onSuccess: (data) => qc.setQueryData(keys.notificationPrefs, data),
  });
  return {
    mutate(p: NotificationPreferenceDto, opts?: { onError?: (err: Error) => void }) {
      const prev = qc.getQueryData<NotificationPreferencesDto>(keys.notificationPrefs);
      if (prev)
        qc.setQueryData<NotificationPreferencesDto>(keys.notificationPrefs, {
          ...prev,
          preferences: prev.preferences.map((x) =>
            x.type === p.type && x.channel === p.channel ? p : x,
          ),
        });
      m.mutate(p, {
        onError: (err) => {
          if (prev) qc.setQueryData(keys.notificationPrefs, prev);
          opts?.onError?.(err);
        },
      });
    },
  };
}

/* ---------- Simple mode ---------- */

export function useSimpleHome() {
  return useQuery({
    queryKey: keys.simpleHome,
    queryFn: () => get<SimpleHomeDto>('/api/v1/simple/home'),
    refetchInterval: 60_000,
  });
}

export function useSimplePerson(id: string) {
  return useQuery({
    queryKey: keys.simplePerson(id),
    queryFn: () => get<SimpleConversationDto>(`/api/v1/simple/people/${id}`),
  });
}

export function useMarkHeard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (personId: string) => post<void>(`/api/v1/simple/people/${personId}/heard`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.simpleHome });
      void qc.invalidateQueries({ queryKey: keys.unread });
    },
  });
}

/** Simple mode "Speak to <name>": a voice task given to them in a group you share. */
export function useSendVoiceMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      rec,
      to,
      groupId,
      title,
    }: {
      rec: Recording;
      to: string;
      groupId: string;
      title: string;
    }) => {
      const file = await uploadAudio(rec, 'task_audio');
      return post<TaskDto>('/api/v1/tasks', {
        id: crypto.randomUUID(),
        title,
        groupId,
        assigneeId: to,
        audioFileId: file.id,
      });
    },
    onSuccess: (_t, v) => {
      void qc.invalidateQueries({ queryKey: keys.simplePerson(v.to) });
      void qc.invalidateQueries({ queryKey: keys.simpleHome });
      void qc.invalidateQueries({ queryKey: keys.tasks });
    },
  });
}

export function useSendVoiceReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ rec, taskId }: { rec: Recording; taskId: string; personId: string }) => {
      const file = await uploadAudio(rec, 'comment_audio');
      return post<CommentDto>(`/api/v1/tasks/${taskId}/comments`, {
        id: crypto.randomUUID(),
        audioFileId: file.id,
      });
    },
    onSuccess: (_c, v) => {
      void qc.invalidateQueries({ queryKey: keys.simplePerson(v.personId) });
      void qc.invalidateQueries({ queryKey: keys.simpleHome });
    },
  });
}
