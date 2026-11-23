import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import * as Sentry from '@sentry/node';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { ApiErrorBody } from '@todo/shared';
import { createAuth, type Auth } from './auth/auth';
import { registerAuthBridge } from './auth/bridge';
import type { Config } from './config';
import { createDb, type Db } from './db/client';
import { clientIp } from './lib/client-ip';
import { createCrypto, type CryptoKit } from './lib/crypto';
import { AppError } from './lib/errors';
import { genReqId, loggerOptions } from './lib/logger';
import { createRedis, type RedisClient } from './lib/redis';
import { createAuthGuard, type RequireUser } from './plugins/auth-guard';
import { phoneAuthRoutes } from './routes/auth-phone';
import { localFileRoutes } from './routes/files';
import { healthRoutes } from './routes/health';
import { meRoutes } from './routes/me';
import { adminRoutes, commentRoutes } from './routes/comments';
import { createViewerLoader, type ViewerOf } from './routes/context';
import { groupRoutes } from './routes/groups';
import { taskRoutes } from './routes/tasks';
import { createAvatars } from './services/avatars';
import { createCommentService, type CommentService } from './services/comments';
import { createDailyLimits } from './services/daily-limits';
import { createGroupService, type GroupService } from './services/groups';
import { createReportService, type ReportService } from './services/reports';
import { createAccountService, type AccountService } from './services/account';
import { createAudit, type Audit } from './services/audit';
import { createEmailSender, type EmailSender } from './services/email';
import { createOtpLimiter } from './services/otp-limiter';
import { createSmsSender, type SmsSender } from './services/sms';
import { createStorage } from './services/storage';
import { createTaskService, type TaskService } from './services/tasks';

export interface AppDeps {
  config: Config;
  db: Db;
  redis: RedisClient;
  auth: Auth;
  crypto: CryptoKit;
  audit: Audit;
  email: EmailSender;
  sms: SmsSender;
  storage: ReturnType<typeof createStorage>;
  tasks: TaskService;
  groups: GroupService;
  comments: CommentService;
  reports: ReportService;
  accounts: AccountService;
  viewerOf: ViewerOf;
  requireUser: RequireUser;
  cookieName: string;
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function buildApp(
  config: Config,
): Promise<{ app: FastifyInstance; deps: AppDeps; close: () => Promise<void> }> {
  const app = Fastify({
    logger: loggerOptions(config),
    genReqId,
    requestIdHeader: false,
    // Trust only the platform edge in front of us (Railway), never arbitrary X-Forwarded-For.
    trustProxy: (_addr: string, hop: number) => hop < config.TRUST_PROXY_HOPS,
    bodyLimit: 256 * 1024,
    routerOptions: { maxParamLength: 500 },
  });

  const { db, pool } = createDb(config.DATABASE_URL);
  const redis = createRedis(config.REDIS_URL);
  const crypto = createCrypto({
    encryptionKey: config.DATA_ENCRYPTION_KEY,
    ipSalt: config.IP_HASH_SALT,
  });
  const audit = createAudit(db, crypto);
  const email = createEmailSender(config, app.log);
  const sms = createSmsSender(config, app.log, email);
  const storage = createStorage(config);
  const otpLimiter = createOtpLimiter(redis, config.RATE_LIMITS_ENABLED);
  const auth = createAuth({
    config,
    db,
    redis,
    email,
    sms,
    otpLimiter,
    audit,
    crypto,
    log: app.log,
  });
  const authCtx = await auth.$context;

  const avatarUrl = createAvatars(storage);
  const limits = createDailyLimits(redis, config.RATE_LIMITS_ENABLED);
  const tasks = createTaskService(db, avatarUrl, limits);
  const groups = createGroupService({
    db,
    config,
    crypto,
    audit,
    avatarUrl,
    limits,
    email,
    sms,
    tasks,
  });
  const comments = createCommentService(db, tasks, avatarUrl, limits);
  const reports = createReportService({ db, config, audit, limits, tasks, comments });

  const deps: AppDeps = {
    config,
    db,
    redis,
    auth,
    crypto,
    audit,
    email,
    sms,
    storage,
    tasks,
    groups,
    comments,
    reports,
    viewerOf: createViewerLoader(db),
    accounts: createAccountService(db, storage, crypto, groups),
    requireUser: createAuthGuard(auth, db),
    cookieName: authCtx.authCookies.sessionToken.name,
  };

  app.decorateRequest('user', null);
  app.decorateRequest('authSession', null);
  app.decorateRequest('clientIp', '');

  app.addHook('onRequest', async (req, reply) => {
    req.clientIp = clientIp(req, config.PROXY_SHARED_SECRET);
    reply.header('x-request-id', req.id);
  });

  // CSRF: state-changing API calls (ours and Better Auth's) must come from our own origin. Cookies are also SameSite=Lax,
  // and only JSON/multipart bodies are accepted (no simple cross-site form posts).
  app.addHook('onRequest', async (req) => {
    if (!STATE_CHANGING.has(req.method) || !req.url.startsWith('/api/')) return;
    const origin =
      req.headers.origin ?? (req.headers.referer ? new URL(req.headers.referer).origin : undefined);
    if (origin !== config.APP_ORIGIN) throw new AppError('forbidden', 'Cross-site request blocked');
  });

  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"] },
    },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: false },
    referrerPolicy: { policy: 'no-referrer' },
  });

  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    redis,
    nameSpace: 'rl:',
    enableDraftSpec: true,
    keyGenerator: (req) => req.clientIp || req.ip,
    allowList: () => !config.RATE_LIMITS_ENABLED,
    errorResponseBuilder: (_req, ctx) => {
      const err = new AppError('rate_limited', 'Too many requests', {
        retryAfterSeconds: Math.ceil(ctx.ttl / 1000),
      });
      return err;
    },
  });

  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5 } });

  app.setErrorHandler((err: FastifyError | AppError | ZodError, req, reply) => {
    let body: ApiErrorBody;
    let status: number;
    if (err instanceof AppError) {
      status = err.status;
      body = {
        error: {
          code: err.code,
          message: err.message,
          ...(err.extra.fields ? { fields: err.extra.fields } : {}),
          ...(err.extra.retryAfterSeconds
            ? { retryAfterSeconds: err.extra.retryAfterSeconds }
            : {}),
          ...(err.extra.details ? { details: err.extra.details } : {}),
        } as ApiErrorBody['error'],
        requestId: req.id,
      };
      if (err.extra.retryAfterSeconds)
        reply.header('retry-after', String(err.extra.retryAfterSeconds));
    } else if (err instanceof ZodError) {
      status = 400;
      const fields: Record<string, string> = {};
      for (const issue of err.issues) fields[issue.path.join('.') || '_'] ??= issue.message;
      body = {
        error: {
          code: 'validation_failed',
          message: 'Please check the highlighted fields',
          fields,
        },
        requestId: req.id,
      };
    } else if ((err as FastifyError).code === 'FST_REQ_FILE_TOO_LARGE') {
      status = 413;
      body = { error: { code: 'file_too_large', message: 'File is too large' }, requestId: req.id };
    } else if ((err as FastifyError).statusCode && (err as FastifyError).statusCode! < 500) {
      status = (err as FastifyError).statusCode!;
      const code =
        status === 415 ? 'unsupported_file' : status === 404 ? 'not_found' : 'validation_failed';
      body = {
        error: { code, message: status === 415 ? 'Unsupported content type' : 'Invalid request' },
        requestId: req.id,
      };
    } else {
      status = 500;
      req.log.error({ err }, 'unhandled error');
      Sentry.captureException(err, { tags: { requestId: req.id } });
      body = {
        error: { code: 'internal', message: 'Something went wrong. Please try again.' },
        requestId: req.id,
      };
    }
    return reply.status(status).send(body);
  });

  app.setNotFoundHandler((req, reply) =>
    reply.status(404).send({
      error: { code: 'not_found', message: 'Not found' },
      requestId: req.id,
    } satisfies ApiErrorBody),
  );

  healthRoutes(app, deps);
  registerAuthBridge(app, auth, { origin: config.APP_ORIGIN, ipOf: (req) => req.clientIp });
  phoneAuthRoutes(app, deps);
  meRoutes(app, deps);
  taskRoutes(app, deps);
  groupRoutes(app, deps);
  commentRoutes(app, deps);
  adminRoutes(app, deps);
  localFileRoutes(app, deps);

  const close = async () => {
    await app.close();
    await pool.end();
    redis.disconnect();
  };
  return { app, deps, close };
}
