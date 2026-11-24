import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import {
  ACTIVITY_TYPES,
  GROUP_ROLES,
  INVITE_CHANNELS,
  REPORT_REASONS,
  REPORT_STATUSES,
  REPORT_TARGETS,
} from '@todo/shared';

/*
 * Better Auth owns users/sessions/accounts/verifications; property names on those tables
 * must match Better Auth's field names (camelCase), while the SQL column names are snake_case.
 * Phase 1: users, tasks, activity. Phase 2: groups, members, invites, comments, reports.
 * Phase 3 (notifications) arrives in a later migration.
 */

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () =>
  ts('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const themeEnum = pgEnum('theme', ['light', 'dark', 'system']);
export const taskStatusEnum = pgEnum('task_status', ['todo', 'in_progress', 'done']);
export const taskPriorityEnum = pgEnum('task_priority', ['low', 'medium', 'high']);
export const taskSourceEnum = pgEnum('task_source', ['text', 'voice']);
export const fileKindEnum = pgEnum('file_kind', ['avatar', 'task_audio', 'comment_audio']);
export const fileStatusEnum = pgEnum('file_status', ['pending', 'ready', 'failed']);
export const consentKindEnum = pgEnum('consent_kind', ['terms', 'privacy']);
export const activityTypeEnum = pgEnum('activity_type', ACTIVITY_TYPES);
export const groupRoleEnum = pgEnum('group_role', GROUP_ROLES);
export const inviteChannelEnum = pgEnum('invite_channel', INVITE_CHANNELS);
export const reportTargetEnum = pgEnum('report_target', REPORT_TARGETS);
export const reportReasonEnum = pgEnum('report_reason', REPORT_REASONS);
export const reportStatusEnum = pgEnum('report_status', REPORT_STATUSES);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    name: varchar('name', { length: 120 }).notNull(),
    email: varchar('email', { length: 254 }).notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    /** true for phone-only accounts: the email is an internal placeholder, never shown or emailed. */
    emailIsPlaceholder: boolean('email_is_placeholder').notNull().default(false),
    phoneNumber: varchar('phone_number', { length: 20 }),
    phoneNumberVerified: boolean('phone_number_verified').notNull().default(false),
    /** Google profile picture URL (Better Auth field). Uploaded avatars use avatarFileId. */
    image: text('image'),
    avatarFileId: uuid('avatar_file_id'),
    locale: varchar('locale', { length: 10 }).notNull().default('en'),
    timeZone: varchar('time_zone', { length: 64 }).notNull().default('Asia/Kolkata'),
    theme: themeEnum('theme').notNull().default('system'),
    simpleMode: boolean('simple_mode').notNull().default(false),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: ts('locked_until'),
    suspendedAt: ts('suspended_at'),
    suspensionReason: varchar('suspension_reason', { length: 500 }),
    /** Kept only for the legal-retention record on account deletion. */
    signupIp: varchar('signup_ip', { length: 64 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_email_unique').on(t.email),
    uniqueIndex('users_phone_unique').on(t.phoneNumber),
    index('users_unverified_idx')
      .on(t.createdAt)
      .where(sql`email_verified = false AND phone_number_verified = false`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    expiresAt: ts('expires_at').notNull(),
    ipAddress: varchar('ip_address', { length: 64 }),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('sessions_token_unique').on(t.token),
    index('sessions_user_idx').on(t.userId),
  ],
);

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: varchar('provider_id', { length: 40 }).notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: ts('access_token_expires_at'),
    refreshTokenExpiresAt: ts('refresh_token_expires_at'),
    scope: text('scope'),
    /** Argon2id hash */
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('accounts_user_idx').on(t.userId),
    uniqueIndex('accounts_provider_unique').on(t.providerId, t.accountId),
  ],
);

export const verifications = pgTable(
  'verifications',
  {
    id: uuid('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: ts('expires_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
);

export const consents = pgTable(
  'consents',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: consentKindEnum('kind').notNull(),
    version: varchar('version', { length: 40 }).notNull(),
    ipHash: varchar('ip_hash', { length: 64 }),
    grantedAt: ts('granted_at').notNull().defaultNow(),
  },
  (t) => [index('consents_user_idx').on(t.userId)],
);

/** Registration details kept for 180 days after account deletion (IT Rules 3(1)(h)). Encrypted. */
export const deletedAccounts = pgTable(
  'deleted_accounts',
  {
    id: uuid('id').primaryKey(),
    formerUserId: uuid('former_user_id').notNull(),
    /** AES-256-GCM encrypted JSON: { name, email, phoneNumber, signupIp } */
    encryptedData: text('encrypted_data').notNull(),
    signedUpAt: ts('signed_up_at').notNull(),
    deletedAt: ts('deleted_at').notNull().defaultNow(),
    purgeAfter: ts('purge_after').notNull(),
  },
  (t) => [index('deleted_accounts_purge_idx').on(t.purgeAfter)],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: varchar('action', { length: 60 }).notNull(),
    targetType: varchar('target_type', { length: 40 }),
    targetId: varchar('target_id', { length: 64 }),
    /** Never contains passwords, OTPs, tokens or full emails/phones. */
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ipHash: varchar('ip_hash', { length: 64 }),
    userAgent: text('user_agent'),
    requestId: varchar('request_id', { length: 64 }),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_actor_idx').on(t.actorUserId, t.createdAt),
    index('audit_action_idx').on(t.action, t.createdAt),
  ],
);

export const files = pgTable(
  'files',
  {
    id: uuid('id').primaryKey(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    kind: fileKindEnum('kind').notNull(),
    storageKey: text('storage_key').notNull(),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    durationMs: integer('duration_ms'),
    status: fileStatusEnum('status').notNull().default('ready'),
    deletedAt: ts('deleted_at'),
    purgeAfter: ts('purge_after'),
    createdAt: createdAt(),
  },
  (t) => [index('files_owner_idx').on(t.ownerId), index('files_purge_idx').on(t.purgeAfter)],
);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey(),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description'),
    dueAt: ts('due_at'),
    dueHasTime: boolean('due_has_time').notNull().default(false),
    priority: taskPriorityEnum('priority').notNull().default('medium'),
    status: taskStatusEnum('status').notNull().default('todo'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    /** null = Personal */
    groupId: uuid('group_id').references(() => groups.id, { onDelete: 'cascade' }),
    completedAt: ts('completed_at'),
    source: taskSourceEnum('source').notNull().default('text'),
    audioFileId: uuid('audio_file_id').references(() => files.id, { onDelete: 'set null' }),
    transcript: text('transcript'),
    version: integer('version').notNull().default(1),
    deletedAt: ts('deleted_at'),
    deletedBy: uuid('deleted_by').references(() => users.id, { onDelete: 'set null' }),
    removedAt: ts('removed_at'),
    removedBy: uuid('removed_by').references(() => users.id, { onDelete: 'set null' }),
    purgeAfter: ts('purge_after'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('tasks_assignee_idx')
      .on(t.assigneeId, t.status, t.dueAt)
      .where(sql`deleted_at IS NULL`),
    index('tasks_creator_idx')
      .on(t.createdBy, t.status)
      .where(sql`deleted_at IS NULL`),
    index('tasks_group_idx')
      .on(t.groupId, t.status, t.dueAt)
      .where(sql`deleted_at IS NULL`),
    index('tasks_group_assignee_idx')
      .on(t.groupId, t.assigneeId, t.status)
      .where(sql`deleted_at IS NULL`),
    index('tasks_purge_idx').on(t.purgeAfter),
    index('tasks_search_trgm_idx').using(
      'gin',
      sql`(title || ' ' || coalesce(description, '')) gin_trgm_ops`,
    ),
  ],
);

export const taskActivity = pgTable(
  'task_activity',
  {
    id: uuid('id').primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    type: activityTypeEnum('type').notNull(),
    fromValue: jsonb('from_value'),
    toValue: jsonb('to_value'),
    ipHash: varchar('ip_hash', { length: 64 }),
    createdAt: createdAt(),
  },
  (t) => [index('task_activity_task_idx').on(t.taskId, t.createdAt)],
);

export const groups = pgTable(
  'groups',
  {
    id: uuid('id').primaryKey(),
    name: varchar('name', { length: 60 }).notNull(),
    /** A single emoji, or null for the default icon. */
    icon: varchar('icon', { length: 16 }),
    membersCanInvite: boolean('members_can_invite').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    deletedAt: ts('deleted_at'),
    deletedBy: uuid('deleted_by').references(() => users.id, { onDelete: 'set null' }),
    removedAt: ts('removed_at'),
    removedBy: uuid('removed_by').references(() => users.id, { onDelete: 'set null' }),
    purgeAfter: ts('purge_after'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('groups_purge_idx').on(t.purgeAfter)],
);

export const groupMembers = pgTable(
  'group_members',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: groupRoleEnum('role').notNull().default('member'),
    joinedAt: ts('joined_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.userId] }),
    index('group_members_user_idx').on(t.userId),
  ],
);

export const groupInvites = pgTable(
  'group_invites',
  {
    id: uuid('id').primaryKey(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    code: varchar('code', { length: 16 }).notNull(),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    channel: inviteChannelEnum('channel').notNull(),
    /**
     * Email/phone invites: a keyed hash of the normalised address (so we don't keep a
     * non-member's contact details) plus a masked copy to show in the invite list.
     */
    targetHash: varchar('target_hash', { length: 64 }),
    targetMasked: varchar('target_masked', { length: 64 }),
    maxUses: integer('max_uses').notNull(),
    useCount: integer('use_count').notNull().default(0),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('group_invites_code_unique').on(t.code),
    index('group_invites_group_idx').on(t.groupId, t.createdAt),
  ],
);

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    /** Text comments. Voice comments (Phase 3) may have only audio + transcript. */
    body: varchar('body', { length: 2000 }),
    audioFileId: uuid('audio_file_id').references(() => files.id, { onDelete: 'set null' }),
    transcript: text('transcript'),
    editedAt: ts('edited_at'),
    deletedAt: ts('deleted_at'),
    removedAt: ts('removed_at'),
    removedBy: uuid('removed_by').references(() => users.id, { onDelete: 'set null' }),
    purgeAfter: ts('purge_after'),
    createdAt: createdAt(),
  },
  (t) => [
    index('comments_task_idx')
      .on(t.taskId, t.createdAt)
      .where(sql`deleted_at IS NULL`),
    index('comments_author_idx').on(t.authorId),
    index('comments_purge_idx').on(t.purgeAfter),
  ],
);

export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey(),
    reporterId: uuid('reporter_id').references(() => users.id, { onDelete: 'set null' }),
    targetType: reportTargetEnum('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    /** Group the item belongs to (or where the reported member was seen), for context. */
    groupId: uuid('group_id').references(() => groups.id, { onDelete: 'set null' }),
    /** The person responsible: author, creator, or the reported user. */
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    reason: reportReasonEnum('reason').notNull(),
    details: varchar('details', { length: 1000 }),
    /** The reported content as it was at report time (evidence if it is edited later). */
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull().default({}),
    status: reportStatusEnum('status').notNull().default('open'),
    action: varchar('action', { length: 20 }),
    resolutionNote: varchar('resolution_note', { length: 500 }),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: ts('resolved_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('reports_status_idx').on(t.status, t.createdAt),
    index('reports_target_idx').on(t.targetType, t.targetId),
    uniqueIndex('reports_open_unique')
      .on(t.reporterId, t.targetType, t.targetId)
      .where(sql`status = 'open'`),
  ],
);

export const schema = {
  users,
  sessions,
  accounts,
  verifications,
  consents,
  deletedAccounts,
  auditLogs,
  files,
  tasks,
  taskActivity,
  groups,
  groupMembers,
  groupInvites,
  comments,
  reports,
};
