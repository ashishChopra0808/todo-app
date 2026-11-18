export const TASK_STATUSES = ['todo', 'in_progress', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_SOURCES = ['text', 'voice'] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];

export const TASK_VIEWS = ['today', 'mine', 'overdue', 'completed'] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

export const THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEMES)[number];

export const LOCALES = ['en', 'hi'] as const;
export type AppLocale = (typeof LOCALES)[number];

export const GROUP_ROLES = ['admin', 'member'] as const;
export type GroupRole = (typeof GROUP_ROLES)[number];

export const ACTIVITY_TYPES = [
  'created',
  'title_changed',
  'description_changed',
  'due_changed',
  'priority_changed',
  'status_changed',
  'assigned',
  'unassigned',
  'deleted',
  'restored',
  'removed',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/** How long hidden (deleted/removed) content and deleted-account records are kept. */
export const RETENTION_DAYS = 180;
/** Unverified sign-ups are deleted after this many hours. */
export const UNVERIFIED_ACCOUNT_TTL_HOURS = 24;

export const OTP = {
  length: 6,
  expiresInSeconds: 300,
  maxAttempts: 5,
  resendCooldownSeconds: 60,
  maxSendsPerHour: 5,
} as const;

export const LOGIN_LOCKOUT = { maxFailures: 10, lockMinutes: 15 } as const;

export const LIMITS = {
  taskTitle: 200,
  taskDescription: 5000,
  name: 80,
  search: 100,
  avatarBytes: 2 * 1024 * 1024,
  passwordMin: 8,
  passwordMax: 128,
} as const;
