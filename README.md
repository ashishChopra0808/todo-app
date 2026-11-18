# ToDo

Shared tasks for families, offices and roommates — a responsive web app and installable PWA.
English and Hindi, light and dark themes, WCAG 2.2 AA.

**Status:** Phase 1 (auth, profile, personal tasks). Plan and decisions live in the claude.ai project
docs: `phase-1-spec.md`, `tech-stack.md`, `design-direction.md`, `kickoff-checklist.md`.

## Repository layout

```
apps/
  api/        Fastify REST API + Better Auth + background jobs (Node 22, TypeScript)
  web/        React + Vite PWA (TanStack Router/Query, react-i18next, React Aria)
packages/
  shared/     Zod schemas, permission rules, date/time-zone logic, password policy, API types
  i18n/       en.json / hi.json translations + helpers (used by web and API emails/SMS)
  tokens/     Design tokens → CSS variables (contrast-checked in tests)
```

The shared packages are plain TypeScript, so the future Expo mobile app can reuse them unchanged.

## Run it locally

Requirements: Node 22, pnpm 10, Docker (for Postgres + Redis).

```bash
pnpm install
cp .env.example .env            # then replace the three "change-me" secrets
docker compose up -d postgres redis
pnpm db:migrate
pnpm db:seed                    # optional: demo@todo.test / mango-river-lamp-91
pnpm dev                        # API on :3000, web on http://localhost:5173
```

The web dev server proxies `/api` to the API, so everything runs on one origin, just like production.

**One-time codes in development** are not sent anywhere. They are written to `apps/api/.outbox/`
(the `file` email/SMS drivers). Print the latest ones with:

```bash
pnpm --filter @todo/api otp
```

## Tests

```bash
pnpm lint && pnpm format:check
pnpm typecheck
pnpm test          # unit tests (shared, i18n, tokens, web) + API integration tests (needs Postgres + Redis)
pnpm test:e2e      # Playwright on phone + desktop viewports, with axe accessibility checks
```

- API integration tests use `TEST_DATABASE_URL` (default `postgres://postgres:postgres@localhost:5432/todo_test`)
  and `TEST_REDIS_URL` (default `redis://localhost:6379/1`). The schema is recreated on every run.
- E2E tests build the production bundle, serve it with the real security headers, and start their
  own API against `E2E_DATABASE_URL` (default database `todo_e2e`). First run:
  `pnpm --filter @todo/web exec playwright install chromium` (or set `PW_CHANNEL=chrome` to use an installed Chrome).

CI (GitHub Actions) runs all of the above on every push, plus a Docker build of the API.

## Environments

|            | Web                                           | API                         | Data                                         |
| ---------- | --------------------------------------------- | --------------------------- | -------------------------------------------- |
| dev        | Vite dev server                               | `tsx watch`                 | Docker Compose Postgres + Redis, local files |
| staging    | Cloudflare Pages (`/api` proxied to Railway)  | Railway (Singapore), Docker | Railway Postgres + Redis, Cloudflare R2      |
| production | same as staging, separate project/environment |                             |                                              |

Set up staging with [docs/staging-setup.md](docs/staging-setup.md). All configuration is in environment
variables — see [.env.example](.env.example). The API refuses to start in staging/production if a
required setting is missing or unsafe (for example the log email driver, or an `http://` origin).

## How the main pieces work

- **Auth** — Better Auth with email/phone + password, Google, OTP verification (6 digits, 5 minutes,
  5 tries, 60 s resend cooldown, 5 per hour), password reset by email or SMS, Argon2id hashing,
  lockout after 10 failures, rate limits in Redis, HttpOnly SameSite cookies, audit log.
  Only verified users get a session. Phone sign-up creates the account only after the OTP is verified.
- **Authorisation** — every `/api/v1` route checks the session and verification status, then
  applies the rules in `packages/shared/src/rules.ts`. Other users' tasks return 404.
- **Security** — strict CSP and security headers (web: `apps/web/public/_headers`; API: Helmet),
  same-origin check on every state-changing request, input validation with Zod, uploads re-encoded,
  files served through signed, expiring URLs. Logs are JSON with a request ID and never contain
  passwords, codes, tokens, emails or phone numbers.
- **Retention (IT Rules / DPDP)** — deleted content is hidden at once and purged after 180 days.
  Deleting an account keeps the sign-up details encrypted for 180 days, then purges them. A daily
  job (`apps/api/src/jobs/maintenance.ts`) does the purging and removes unverified sign-ups after 24 hours.
- **Time zones** — all times are stored in UTC. "Today" and "Overdue" use the user's time zone.
  Date-only due dates are compared as calendar dates.
- **i18n** — no hard-coded UI strings. Add a language by adding `packages/i18n/src/locales/<code>.json`
  (a test checks every key exists in every language). Layouts use logical CSS properties, ready for RTL.

## Database

Drizzle ORM with SQL migrations in `apps/api/drizzle/`. After changing `apps/api/src/db/schema.ts`:

```bash
pnpm db:generate   # writes a new migration
pnpm db:migrate
```

Deployed API containers apply pending migrations on start.
