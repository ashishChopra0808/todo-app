import { z } from 'zod';
import { GROUP_ROLES, LIMITS } from '../enums';
import { cleanLine } from '../text';
import { emailSchema, phoneSchema } from './common';

export const groupNameSchema = z
  .string()
  .transform(cleanLine)
  .pipe(z.string().min(1, { error: 'required' }).max(LIMITS.groupName, { error: 'too_long' }));

/** One emoji (a grapheme can be several code points, e.g. 👨‍👩‍👧). No letters, digits or markup. */
export const groupIconSchema = z
  .string()
  .trim()
  .max(LIMITS.groupIcon, { error: 'too_long' })
  .refine((v) => v === '' || isSingleEmoji(v), { error: 'invalid' })
  .transform((v) => (v === '' ? null : v));

export function isSingleEmoji(value: string): boolean {
  const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const parts = [...seg.segment(value)];
  if (parts.length !== 1) return false;
  return (
    /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(value) &&
    !/[\p{L}\p{N}<>&"']/u.test(value)
  );
}

export const groupCreateSchema = z
  .object({
    name: groupNameSchema,
    icon: groupIconSchema.nullable().optional(),
  })
  .strict();
export type GroupCreateInput = z.input<typeof groupCreateSchema>;

export const groupUpdateSchema = z
  .object({
    name: groupNameSchema,
    icon: groupIconSchema.nullable(),
    membersCanInvite: z.boolean(),
  })
  .partial()
  .strict();
export type GroupUpdateInput = z.input<typeof groupUpdateSchema>;

export const memberRoleSchema = z.object({ role: z.enum(GROUP_ROLES) }).strict();

export const inviteCreateSchema = z.discriminatedUnion('channel', [
  z.object({ channel: z.literal('link') }).strict(),
  z.object({ channel: z.literal('email'), email: emailSchema }).strict(),
  z.object({ channel: z.literal('phone'), phone: phoneSchema }).strict(),
]);
export type InviteCreateInput = z.input<typeof inviteCreateSchema>;

/** Invite codes: 10 characters from an alphabet without look-alikes (no 0/O, 1/I/L). */
export const INVITE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const inviteCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/, { error: 'invalid' }));
