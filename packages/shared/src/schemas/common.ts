import { z } from 'zod';
import { LIMITS } from '../enums';
import { normalizePhone } from '../phone';
import { cleanLine } from '../text';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ error: 'invalid_email' }));

export const phoneSchema = z
  .string()
  .trim()
  .min(6, { error: 'invalid_phone' })
  .max(20, { error: 'invalid_phone' })
  .transform((v, ctx) => {
    const e164 = normalizePhone(v);
    if (!e164) {
      ctx.addIssue({ code: 'custom', message: 'invalid_phone' });
      return z.NEVER;
    }
    return e164;
  });

export const nameSchema = z
  .string()
  .transform(cleanLine)
  .pipe(z.string().min(1, { error: 'required' }).max(LIMITS.name, { error: 'too_long' }));

export const passwordSchema = z
  .string()
  .min(LIMITS.passwordMin, { error: 'too_short' })
  .max(LIMITS.passwordMax, { error: 'too_long' });

export const otpSchema = z.string().regex(/^\d{6}$/, { error: 'invalid_otp' });

export const uuidSchema = z.uuid();
