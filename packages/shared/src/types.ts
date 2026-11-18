import type { AppLocale, ActivityType, TaskPriority, TaskSource, TaskStatus, Theme } from './enums';

/** Shapes returned by the API. Dates are ISO strings in UTC. */
export interface UserRef {
  id: string;
  name: string;
}

export interface MeDto {
  id: string;
  name: string;
  email: string | null;
  emailVerified: boolean;
  phoneNumber: string | null;
  phoneNumberVerified: boolean;
  avatarUrl: string | null;
  locale: AppLocale;
  timeZone: string;
  theme: Theme;
  simpleMode: boolean;
  hasPassword: boolean;
  providers: string[];
  createdAt: string;
}

export interface TaskDto {
  id: string;
  title: string;
  description: string | null;
  dueAt: string | null;
  dueHasTime: boolean;
  priority: TaskPriority;
  status: TaskStatus;
  source: TaskSource;
  groupId: string | null;
  createdBy: UserRef | null;
  assignee: UserRef | null;
  completedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  permissions: { edit: boolean; delete: boolean; changeStatus: boolean };
}

export interface TaskListResponse {
  items: TaskDto[];
  nextCursor: string | null;
}

export interface TaskCountsDto {
  today: number;
  overdue: number;
  open: number;
}

export interface ActivityDto {
  id: string;
  type: ActivityType;
  actor: UserRef | null;
  from: unknown;
  to: unknown;
  createdAt: string;
}

export interface SessionDto {
  id: string;
  current: boolean;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
}
