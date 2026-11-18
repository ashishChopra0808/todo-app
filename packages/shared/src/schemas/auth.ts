import { z } from 'zod';
import { emailSchema, nameSchema, otpSchema, passwordSchema, phoneSchema } from './common';

export const phoneSignUpSchema = z.object({
  name: nameSchema,
  phoneNumber: phoneSchema,
  password: passwordSchema,
  acceptTerms: z.literal(true, { error: 'consent_required' }),
  locale: z.enum(['en', 'hi']).optional(),
  timeZone: z.string().max(64).optional(),
});
export type PhoneSignUpInput = z.input<typeof phoneSignUpSchema>;

export const emailSignUpSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  acceptTerms: z.literal(true, { error: 'consent_required' }),
});

export const signInSchema = z.union([
  z.object({ email: emailSchema, password: z.string().min(1).max(128) }),
  z.object({ phoneNumber: phoneSchema, password: z.string().min(1).max(128) }),
]);

export const otpVerifySchema = z.object({ code: otpSchema });

export const deleteAccountSchema = z.object({
  password: z.string().max(128).optional(),
  confirm: z.literal('DELETE', { error: 'confirm_required' }),
});
