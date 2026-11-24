export const TASK_STATUSES = ['todo', 'in_progress', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_SOURCES = ['text', 'voice'] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];

/**
 * today/overdue/completed/all: everything the user can see (personal + their groups).
 * mine: assigned to me. assigned_by_me: I created it and assigned it to someone else.
 */
export const TASK_VIEWS = [
  'today',
  'mine',
  'all',
  'assigned_by_me',
  'overdue',
  'completed',
] as const;
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
  'moved',
  'commented',
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

export const INVITE_CHANNELS = ['link', 'email', 'phone'] as const;
export type InviteChannel = (typeof INVITE_CHANNELS)[number];

export const REPORT_TARGETS = ['task', 'comment', 'user', 'group'] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];

export const REPORT_REASONS = [
  'spam',
  'harassment',
  'hate',
  'sexual',
  'child_safety',
  'violence',
  'illegal',
  'impersonation',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_STATUSES = ['open', 'actioned', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** What the owner did with a report. */
export const REPORT_ACTIONS = ['remove', 'dismiss'] as const;
export type ReportAction = (typeof REPORT_ACTIONS)[number];

export const GROUPS = {
  maxMembers: 50,
  maxGroupsPerUser: 50,
  /** Link/code invites. Email and phone invites are single use. */
  linkInviteDays: 7,
  linkInviteMaxUses: 20,
  targetInviteDays: 7,
  codeLength: 10,
} as const;

/** Per user per day (UTC), counted in Redis. */
export const DAILY_LIMITS = {
  invites: 20,
  smsInvites: 10,
  tasks: 200,
  comments: 300,
  reports: 20,
} as const;
export type DailyLimitKind = keyof typeof DAILY_LIMITS;

export const LIMITS = {
  taskTitle: 200,
  taskDescription: 5000,
  name: 80,
  search: 100,
  avatarBytes: 2 * 1024 * 1024,
  passwordMin: 8,
  passwordMax: 128,
  groupName: 60,
  groupIcon: 16,
  comment: 2000,
  reportDetails: 1000,
} as const;
