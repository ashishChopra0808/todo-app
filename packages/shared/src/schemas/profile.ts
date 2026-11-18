import { z } from 'zod';
import { canonicalTimeZone, isValidTimeZone } from '../dates';
import { LOCALES, THEMES } from '../enums';
import { nameSchema } from './common';

export const timeZoneSchema = z
  .string()
  .max(64)
  .refine(isValidTimeZone, { error: 'invalid_time_zone' })
  .transform(canonicalTimeZone);

export const profileUpdateSchema = z
  .object({
    name: nameSchema,
    locale: z.enum(LOCALES),
    timeZone: timeZoneSchema,
    theme: z.enum(THEMES),
    simpleMode: z.boolean(),
  })
  .partial()
  .strict();
export type ProfileUpdateInput = z.input<typeof profileUpdateSchema>;
