import { z } from 'zod';
import { LIMITS, REPORT_REASONS, REPORT_TARGETS } from '../enums';
import { cleanText } from '../text';

export const commentBodySchema = z
  .string()
  .transform(cleanText)
  .pipe(z.string().min(1, { error: 'required' }).max(LIMITS.comment, { error: 'too_long' }));

export const commentCreateSchema = z
  .object({
    /** Client-generated id so offline retries (Phase 3) are idempotent. */
    id: z.uuid().optional(),
    body: commentBodySchema,
  })
  .strict();
export type CommentCreateInput = z.input<typeof commentCreateSchema>;

export const commentUpdateSchema = z.object({ body: commentBodySchema }).strict();

export const commentListQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const reportCreateSchema = z
  .object({
    targetType: z.enum(REPORT_TARGETS),
    targetId: z.uuid(),
    /** For reporting a member: the group where it happened (gives the owner context). */
    groupId: z.uuid().optional(),
    reason: z.enum(REPORT_REASONS),
    details: z
      .string()
      .transform(cleanText)
      .pipe(z.string().max(LIMITS.reportDetails, { error: 'too_long' }))
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional(),
  })
  .strict();
export type ReportCreateInput = z.input<typeof reportCreateSchema>;

export const reportResolveSchema = z
  .object({
    action: z.enum(['remove', 'dismiss']),
    /** Also suspend the person responsible. */
    suspendOwner: z.boolean().default(false),
    note: z
      .string()
      .transform(cleanText)
      .pipe(z.string().max(500, { error: 'too_long' }))
      .optional(),
  })
  .strict();

export const suspendSchema = z
  .object({
    reason: z
      .string()
      .transform(cleanText)
      .pipe(z.string().min(1, { error: 'required' }).max(500, { error: 'too_long' })),
  })
  .strict();

export const adminReportListQuerySchema = z.object({
  status: z.enum(['open', 'actioned', 'dismissed']).default('open'),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
