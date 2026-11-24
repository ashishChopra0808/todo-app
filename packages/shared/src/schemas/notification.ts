import { z } from 'zod';
import { NOTIFICATION_CHANNELS, NOTIFICATION_TYPES } from '../enums';

export const notificationListQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  unread: z.enum(['1', '0']).optional(),
});

export const notificationPreferencesSchema = z
  .object({
    preferences: z
      .array(
        z
          .object({
            type: z.enum(NOTIFICATION_TYPES),
            channel: z.enum(NOTIFICATION_CHANNELS),
            enabled: z.boolean(),
          })
          .strict(),
      )
      .max(NOTIFICATION_TYPES.length * NOTIFICATION_CHANNELS.length),
  })
  .strict();
export type NotificationPreferencesInput = z.input<typeof notificationPreferencesSchema>;

/** A browser's PushSubscription.toJSON(). */
export const pushSubscriptionSchema = z
  .object({
    endpoint: z
      .url()
      .max(1000)
      .refine((u) => u.startsWith('https://'), { error: 'invalid' }),
    keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
    expirationTime: z.number().nullable().optional(),
  })
  .strip();
export type PushSubscriptionInput = z.input<typeof pushSubscriptionSchema>;

export const pushUnsubscribeSchema = z.object({ endpoint: z.url().max(1000) }).strict();
