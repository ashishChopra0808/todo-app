import { onlineManager, useMutationState, type QueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import type { TaskCreateInput, TaskDto } from '@todo/shared';
import { patch, post } from './client';

/**
 * Changes that can wait for the network. Their variables are plain data, so a change made
 * offline survives closing the app (it's saved with the query cache) and is sent later. Each
 * carries a client-made id or a version, so a retry never duplicates or overwrites.
 */
export const OFFLINE = {
  createTask: ['offline', 'createTask'] as const,
  setStatus: ['offline', 'setStatus'] as const,
  addComment: ['offline', 'addComment'] as const,
};

export interface CreateTaskVars extends TaskCreateInput {
  id: string;
}
export interface SetStatusVars {
  task: TaskDto;
  status: TaskDto['status'];
}
export interface AddCommentVars {
  taskId: string;
  id: string;
  body: string;
}

export function registerOfflineMutations(qc: QueryClient) {
  qc.setMutationDefaults(OFFLINE.createTask, {
    mutationFn: (v: CreateTaskVars) => post<TaskDto>('/api/v1/tasks', v),
    retry: 3,
  });
  qc.setMutationDefaults(OFFLINE.setStatus, {
    mutationFn: (v: SetStatusVars) =>
      patch<TaskDto>(`/api/v1/tasks/${v.task.id}`, { version: v.task.version, status: v.status }),
    retry: 3,
  });
  qc.setMutationDefaults(OFFLINE.addComment, {
    mutationFn: (v: AddCommentVars) =>
      post(`/api/v1/tasks/${v.taskId}/comments`, { id: v.id, body: v.body }),
    retry: 3,
  });
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
    () => true,
  );
}

/** Ids of tasks and comments with changes still waiting to be sent. */
export function usePendingSync() {
  const vars = useMutationState({
    filters: { status: 'pending', predicate: (m) => m.options.mutationKey?.[0] === 'offline' },
    select: (m) => ({ key: m.options.mutationKey?.[1] as string, v: m.state.variables }),
  });
  const tasks = new Set<string>();
  const comments = new Set<string>();
  for (const { key, v } of vars) {
    if (key === 'createTask') tasks.add((v as CreateTaskVars).id);
    else if (key === 'setStatus') tasks.add((v as SetStatusVars).task.id);
    else if (key === 'addComment') comments.add((v as AddCommentVars).id);
  }
  return { tasks, comments, count: vars.length };
}
