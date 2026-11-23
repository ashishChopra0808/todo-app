import type {
  AppLocale,
  ActivityType,
  GroupRole,
  InviteChannel,
  ReportAction,
  ReportReason,
  ReportStatus,
  ReportTarget,
  TaskPriority,
  TaskSource,
  TaskStatus,
  Theme,
} from './enums';

/** Shapes returned by the API. Dates are ISO strings in UTC. */
export interface UserRef {
  id: string;
  name: string;
}

/** A person shown with their photo (assignees, members, comment authors). */
export interface PersonRef extends UserRef {
  avatarUrl: string | null;
}

export interface GroupRef {
  id: string;
  name: string;
  icon: string | null;
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
  /** null = Personal */
  group: GroupRef | null;
  createdBy: UserRef | null;
  assignee: PersonRef | null;
  commentCount: number;
  completedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  permissions: {
    edit: boolean;
    delete: boolean;
    changeStatus: boolean;
    assign: boolean;
    move: boolean;
    comment: boolean;
    report: boolean;
  };
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

export interface GroupDto extends GroupRef {
  role: GroupRole;
  memberCount: number;
  membersCanInvite: boolean;
  /** Up to 5 members, admins first, for avatar stacks. */
  preview: PersonRef[];
  openTaskCount: number;
  createdAt: string;
  permissions: { manage: boolean; invite: boolean };
}

export interface GroupMemberDto extends PersonRef {
  role: GroupRole;
  joinedAt: string;
}

export interface InviteDto {
  id: string;
  code: string;
  channel: InviteChannel;
  /** Masked email or phone for email/phone invites. */
  target: string | null;
  invitedBy: UserRef | null;
  maxUses: number;
  useCount: number;
  expiresAt: string;
  createdAt: string;
}

/** Shown on the join page, also to signed-out visitors: no member list. */
export interface InvitePreviewDto {
  code: string;
  group: GroupRef;
  inviterFirstName: string | null;
  memberCount: number;
  /** Email/phone invites can only be accepted by that account. */
  restricted: InviteChannel;
  /** Signed-in viewer is already a member. */
  alreadyMember: boolean;
}

export interface CommentDto {
  id: string;
  taskId: string;
  author: PersonRef | null;
  /** null when removed by a moderator. */
  body: string | null;
  removed: boolean;
  editedAt: string | null;
  createdAt: string;
  permissions: { edit: boolean; delete: boolean; report: boolean };
}

export interface CommentListResponse {
  items: CommentDto[];
  nextCursor: string | null;
}

export interface AdminReportDto {
  id: string;
  targetType: ReportTarget;
  targetId: string;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  action: ReportAction | null;
  reporter: UserRef | null;
  createdAt: string;
  resolvedAt: string | null;
  /** How many open reports point at the same item. */
  sameTargetOpen: number;
}

export interface AdminReportDetailDto extends AdminReportDto {
  /** The content as it was when reported. */
  snapshot: Record<string, unknown>;
  /** The content now (null if purged). */
  current: Record<string, unknown> | null;
  /** The person responsible for the content (author, creator, or the reported user). */
  owner: (UserRef & { suspended: boolean }) | null;
  group: GroupRef | null;
  /** Nearby comments or the task for context. */
  context: Array<{ label: string; text: string; at: string }>;
}
