import type { Db } from '../db/client';
import { auditLogs } from '../db/schema';
import type { CryptoKit } from '../lib/crypto';
import { newId } from '../lib/ids';

export type AuditAction =
  | 'signup'
  | 'login'
  | 'login_failed'
  | 'lockout'
  | 'logout'
  | 'logout_all'
  | 'session_revoke'
  | 'password_reset'
  | 'password_change'
  | 'email_verified'
  | 'phone_verified'
  | 'email_change'
  | 'phone_change'
  | 'account_delete'
  | 'data_export'
  | 'user_suspend'
  | 'user_unsuspend'
  | 'content_remove'
  | 'legal_data_access';

export interface AuditContext {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export function createAudit(db: Db, crypto: CryptoKit) {
  return async function audit(
    action: AuditAction,
    opts: {
      actorUserId?: string | null;
      targetType?: string;
      targetId?: string;
      metadata?: Record<string, unknown>;
    } & AuditContext,
  ) {
    await db.insert(auditLogs).values({
      id: newId(),
      action,
      actorUserId: opts.actorUserId ?? null,
      targetType: opts.targetType ?? null,
      targetId: opts.targetId ?? null,
      metadata: opts.metadata ?? {},
      ipHash: crypto.hashIp(opts.ip),
      userAgent: opts.userAgent?.slice(0, 300) ?? null,
      requestId: opts.requestId ?? null,
    });
  };
}
export type Audit = ReturnType<typeof createAudit>;
