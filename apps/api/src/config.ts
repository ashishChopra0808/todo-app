import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /** Which deployment this is. Controls drivers and safety checks. */
    APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    PORT: z.coerce.number().int().default(3000),
    HOST: z.string().default('0.0.0.0'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),

    /** Public origin of the web app. The API is served on the same origin under /api. */
    APP_ORIGIN: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
    /** base64 of 32 random bytes; encrypts legally retained records. */
    DATA_ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be base64 of 32 bytes'),
    IP_HASH_SALT: z.string().min(16),

    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),

    EMAIL_DRIVER: z.enum(['resend', 'file', 'log']).default('log'),
    EMAIL_FROM: z.string().default('ToDo <no-reply@example.com>'),
    RESEND_API_KEY: z.string().optional(),

    SMS_DRIVER: z.enum(['msg91', 'forward-email', 'file', 'log']).default('log'),
    MSG91_AUTH_KEY: z.string().optional(),
    MSG91_OTP_TEMPLATE_ID: z.string().optional(),
    /** Staging: SMS texts are emailed here instead of being sent (until DLT approval). */
    SMS_FORWARD_TO: z.string().optional(),

    /** Where the file/forward drivers write messages in dev and tests. */
    OUTBOX_DIR: z.string().default('.outbox'),

    STORAGE_DRIVER: z.enum(['s3', 'local']).default('local'),
    LOCAL_STORAGE_DIR: z.string().default('.storage'),
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default('auto'),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),

    /** Shared with the Cloudflare Pages proxy so the API can trust its client-IP header. */
    PROXY_SHARED_SECRET: z.string().optional(),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(1),

    SENTRY_DSN: z.string().optional(),
    TERMS_VERSION: z.string().default('2026-11-draft'),
    PRIVACY_VERSION: z.string().default('2026-11-draft'),
    RUN_WORKER_IN_PROCESS: bool.default(true),
    /** Rate limits on in all environments by default; tests can switch them off per suite. */
    RATE_LIMITS_ENABLED: bool.default(true),
  })
  .superRefine((env, ctx) => {
    const deployed = env.APP_ENV === 'staging' || env.APP_ENV === 'production';
    if (!deployed) return;
    const need = (key: keyof typeof env, why: string) => {
      if (!env[key])
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `required in ${env.APP_ENV}: ${why}`,
        });
    };
    if (env.EMAIL_DRIVER !== 'resend')
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_DRIVER'],
        message: 'must be resend when deployed',
      });
    need('RESEND_API_KEY', 'email OTP');
    if (env.STORAGE_DRIVER !== 's3')
      ctx.addIssue({
        code: 'custom',
        path: ['STORAGE_DRIVER'],
        message: 'must be s3 when deployed',
      });
    need('S3_BUCKET', 'file storage');
    need('S3_ENDPOINT', 'file storage');
    need('S3_ACCESS_KEY_ID', 'file storage');
    need('S3_SECRET_ACCESS_KEY', 'file storage');
    need('PROXY_SHARED_SECRET', 'client IPs for rate limits');
    if (env.SMS_DRIVER === 'msg91') {
      need('MSG91_AUTH_KEY', 'SMS');
      need('MSG91_OTP_TEMPLATE_ID', 'SMS');
    } else if (env.SMS_DRIVER === 'forward-email') {
      need('SMS_FORWARD_TO', 'forwarding SMS on staging');
      if (env.APP_ENV === 'production')
        ctx.addIssue({
          code: 'custom',
          path: ['SMS_DRIVER'],
          message: 'forward-email is not allowed in production',
        });
    } else {
      ctx.addIssue({
        code: 'custom',
        path: ['SMS_DRIVER'],
        message: 'use msg91 or forward-email when deployed',
      });
    }
    if (!env.APP_ORIGIN.startsWith('https://'))
      ctx.addIssue({
        code: 'custom',
        path: ['APP_ORIGIN'],
        message: 'must be https when deployed',
      });
  });

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    // Never print values — only which keys are wrong.
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}
