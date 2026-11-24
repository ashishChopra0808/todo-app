# Staging setup (do this once, from a phone or laptop)

After this, every push to `main` deploys to staging automatically:

- **Railway** runs the API, background jobs, Postgres and Redis (Singapore).
- **Cloudflare Pages** serves the web app and forwards `/api/*` to Railway.

Never paste secrets into chat or into the repository. Enter them only in Railway, Cloudflare or GitHub settings.

**Secrets you'll create.** Where this guide says _"a long random secret"_, use your password manager's
"generate password" button (Google Password Manager, iCloud Keychain, Bitwarden…). Choose 48 characters,
letters and numbers only. Save each one in the password manager too.

---

## 1. Cloudflare R2 (file storage)

1. Cloudflare dashboard → **R2 Object Storage** → **Create bucket** → name `todo-staging`, location _Asia-Pacific_.
2. R2 → **Manage API tokens** → **Create API token**.
   - Permissions: _Object Read & Write_.
   - Scope: only the bucket `todo-staging`.
3. Keep that page open. You need the **Access Key ID**, the **Secret Access Key** and the **endpoint**
   (`https://<account-id>.r2.cloudflarestorage.com`) in step 3.

## 2. Resend (email codes)

1. Sign up at resend.com with **the email address you'll test with**.
2. **API Keys** → **Create API key** (permission _Sending access_). Keep it for step 3.

Until a domain is added, Resend only delivers to your own sign-up email. That's enough to test, because
staging also forwards SMS codes to that address (see `SMS_FORWARD_TO`).

## 3. Railway (API, Postgres, Redis)

1. railway.com → sign in with GitHub → **New Project** → **Deploy from GitHub repo** → `ashishChopra0808/todo-app`.
   Name the service `api`.
2. In the project, click **Create** → **Database** → **PostgreSQL**. Then again → **Database** → **Redis**.
3. Open the `api` service → **Settings**:
   - **Config-as-code / Railway config file**: `apps/api/railway.json`. This sets the Dockerfile and the health check.
   - **Region**: Southeast Asia (Singapore).
   - **Networking** → **Generate Domain**. Copy the URL, for example `https://api-staging-xxxx.up.railway.app`.
   - **Source** → turn on **Wait for CI**, so a red CI run never deploys.
4. Open the `api` service → **Variables** → **Raw Editor**. Paste the block below, then replace each `<…>`:

```
NODE_ENV=production
APP_ENV=staging
LOG_LEVEL=info
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
APP_ORIGIN=https://<your-pages-project>.pages.dev
BETTER_AUTH_SECRET=<a long random secret>
DATA_ENCRYPTION_KEY=<another long random secret>
IP_HASH_SALT=<another long random secret>
PROXY_SHARED_SECRET=<another long random secret — you will paste the same value into Cloudflare>
TRUST_PROXY_HOPS=1
EMAIL_DRIVER=resend
EMAIL_FROM=ToDo <onboarding@resend.dev>
RESEND_API_KEY=<from step 2>
SMS_DRIVER=forward-email
SMS_FORWARD_TO=<your email — SMS codes arrive here until DLT is approved>
STORAGE_DRIVER=s3
S3_ENDPOINT=<R2 endpoint from step 1>
S3_REGION=auto
S3_BUCKET=todo-staging
S3_ACCESS_KEY_ID=<from step 1>
S3_SECRET_ACCESS_KEY=<from step 1>
RUN_WORKER_IN_PROCESS=true
RATE_LIMITS_ENABLED=true
SENTRY_DSN=<optional, from step 6>
OWNER_EMAILS=<your email — only this verified account can open /admin to review reports>
VAPID_PUBLIC_KEY=<web push public key — see "Phase 3" below>
VAPID_PRIVATE_KEY=<web push private key>
VAPID_SUBJECT=mailto:<your email>
```

5. **Deploy**. The first build takes a few minutes. When it's done, open `<railway url>/health/ready`.
   You should see `{"status":"ok",...}`.

Keep `DATA_ENCRYPTION_KEY` safe and never change it. It encrypts the records kept after an account is
deleted, and changing it makes those records unreadable.

## 4. Cloudflare Pages (web app)

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → `todo-app`.
2. Build settings:
   - Framework preset: **None**
   - Root directory: `apps/web`
   - Build command: `npx pnpm@10.28.0 install --frozen-lockfile && npx pnpm@10.28.0 run build`
   - Build output directory: `dist`
3. **Environment variables** (production branch = `main`):
   - `NODE_VERSION` = `22`
   - `API_ORIGIN` = the Railway URL from step 3
   - `PROXY_SHARED_SECRET` = the **same** value as in Railway. Click **Encrypt**.
   - `VITE_APP_ENV` = `staging`
   - `VITE_SENTRY_DSN` = optional, from step 6
4. **Save and Deploy**. Your app is at `https://<project>.pages.dev`.
   If that differs from the `APP_ORIGIN` you guessed in step 3, update `APP_ORIGIN` in Railway.

## 5. Google sign-in (optional for first tests)

1. console.cloud.google.com → create a project `ToDo` → **APIs & Services** → **OAuth consent screen**.
   Choose _External_ and _Testing_, then add your Gmail address as a test user.
2. **Credentials** → **Create credentials** → **OAuth client ID** → _Web application_:
   - Authorised JavaScript origin: `https://<project>.pages.dev`
   - Authorised redirect URI: `https://<project>.pages.dev/api/auth/callback/google`
3. Add to Railway variables: `GOOGLE_CLIENT_ID=…` and `GOOGLE_CLIENT_SECRET=…`.
   The "Continue with Google" button appears automatically.

## 6. Sentry (optional)

sentry.io → create two projects: _Node_ (API) and _React_ (web). Copy each DSN into
`SENTRY_DSN` (Railway) and `VITE_SENTRY_DSN` (Cloudflare Pages).

## 7. Uptime check (optional)

Point any free uptime monitor (UptimeRobot, Better Stack) at `https://<project>.pages.dev/api/health`
(checks the website and the API together) and at `<railway url>/health/ready` (also checks Postgres and Redis).

---

## What to test on your phone

1. Sign up with email → code arrives by email → you land on Today.
2. Sign up with phone → the "SMS" arrives in your email inbox (staging only) → enter the code.
3. Log out → **Forgot password** → reset by email.
4. Add tasks with and without dates and times. Tick them done and undo. Edit, delete, search, filter.
5. Settings: change language to हिन्दी, switch theme, change time zone, upload a photo,
   add a phone number, log out from all devices, download your data, delete the account.
6. Chrome menu → **Add to Home screen**. ToDo opens like an app.

### Phase 2: groups (you need two accounts)

Use your phone for one account and a private/incognito window (or a second phone) for the other.

1. **Groups** tab → **Create a group** → name it, pick an icon. The invite sheet opens with a link and a code.
2. **Share link** (or **Copy link**) and open it in the other window. Signed out, it shows the group and asks
   you to create an account or log in; after the code is verified it comes back to the invite → **Join group**.
3. In the first account: **Add task** on the group page → under **Where & who**, pick the other person.
4. In the second account: the task is in **My tasks** with the group's name. Tick it done, open it, add a comment.
5. In the first account: the group page → **Show done** → open the task. You see the status change and the comment.
6. **Report** a comment (from the second account's comment) → open `https://<project>.pages.dev/admin` while
   signed in with the email in `OWNER_EMAILS` → open the report → **Remove content**. The comment now reads
   "Removed by a moderator" for everyone.
7. Group settings: make the other person an admin, remove them, leave, delete the group. Try leaving as the
   only admin: it tells you to make someone else admin first.

Invites by **email** to other people need your domain verified in Resend (until then Resend only delivers to
your own address). Invites by **SMS** are emailed to `SMS_FORWARD_TO` on staging, like the codes.

### Phase 3 and 4: voice, notifications, offline, Simple mode

Push notifications need a key pair, made once: on any computer with Node.js run
`npx web-push generate-vapid-keys` and paste the two values into the Railway `api` variables above.
Without them everything else works and the push switches are simply hidden.

1. **Voice task:** Today → the microphone button (next to New task) → allow the microphone → say
   something → **Stop** → listen → **Use this recording** → change the title if you like → **Save**.
   Open the task: the recording plays.
2. **Voice reply:** open a group task → in Comments tap **Voice** → record → **Send reply**.
3. **Notifications:** with two accounts in a group, give a task to the other person. Their
   **Inbox** tab shows a badge; the entry opens the task. Comment and mark done: the creator is told.
   Settings → **Notifications**: switch types on/off per channel, and **Turn on** push for the device
   (on iPhone, add the app to the Home Screen first and turn it on from there).
4. **Reminders:** a task due in the next hour gets a "due soon" notification (checked every 15 min);
   a late task gets "overdue" once.
5. **Offline:** open Tasks, turn on airplane mode. You see "You're offline". Tick a task done and add
   a new one: both show **Waiting to sync**. Turn airplane mode off: they sync on their own.
6. **Install:** Settings → **App** → **Install ToDo** (Android/desktop) or Share → Add to Home Screen
   (iPhone). After a new deploy, the app offers **Reload** to update.
7. **Simple mode:** on the second account, Settings → **Turn on Simple mode**. Big buttons, your
   people, **Hear** reads the screen aloud. Tap a person → **Speak to …** → **Stop** → **Send**. The
   first account gets it as a voice task. Settings is reachable from "Switch to the full app".

## Production later

The full list is in `docs/launch-checklist.md`.

Create a `production` environment in the same Railway project and a second Pages project
(or a production branch) with its own secrets, a real domain, `SMS_DRIVER=msg91` and a verified
Resend domain. Phone invites in production also need a second DLT template (`MSG91_INVITE_TEMPLATE_ID`,
variables `inviter`, `group`, `link`); without it the app says SMS invites aren't available yet. `SMS_DRIVER=forward-email` is refused in production.
