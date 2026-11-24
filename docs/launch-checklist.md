# Launch checklist (Phase 4)

What has to be true before ToDo goes public. Items marked **(you)** need an account, a decision
or a person; everything else is already in the code and checked by CI.

## 1. Accounts and settings (you)

- [ ] **Domain** bought and added to Cloudflare. Pages project uses it; Railway `APP_ORIGIN` matches.
- [ ] **Resend**: domain verified (SPF/DKIM). Until then email only reaches your own address.
- [ ] **MSG91 + DLT**: OTP template and invite template approved; `SMS_DRIVER=msg91`,
      `MSG91_OTP_TEMPLATE_ID`, `MSG91_INVITE_TEMPLATE_ID` set.
- [ ] **Web push keys** (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:<you>`) on the
      Railway `api` service. Generate once with `npx web-push generate-vapid-keys`; never change
      them (every device would have to turn push on again).
- [ ] **Google sign-in**: production redirect URI added in Google Cloud.
- [ ] **Sentry** DSNs set for web (`VITE_SENTRY_DSN`) and API (`SENTRY_DSN`).
- [ ] **OWNER_EMAILS** set to the account(s) that review reports.
- [ ] **Uptime monitor** on `https://<domain>/api/health` and `<railway url>/health/ready`.
- [ ] Separate **production** Railway environment and Pages project, with their own secrets
      (`APP_ENV=production`). Staging keeps `SMS_DRIVER=forward-email`, which production refuses.

## 2. Legal (you + a lawyer)

- [ ] Privacy policy, Terms and acceptable use reviewed by a lawyer (draft text under `legal` in
      `packages/i18n/src/locales/en.json` and `hi.json`, shown at `/legal/...`).
- [ ] Grievance officer named, with a working email (IT Rules 2021, DPDP Act).
- [ ] Hindi text reviewed by a native speaker (strings in `packages/i18n/src/locales/hi.json`).

## 3. Backups

- Daily `pg_dump` at 02:30 IST to a private R2 bucket: `.github/workflows/backup.yml`. It skips
  itself until these GitHub secrets exist: `BACKUP_DATABASE_URL`, `BACKUP_S3_ENDPOINT`,
  `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`.
- [ ] **(you)** Create the `todo-backups` bucket, an R2 token for it only, a lifecycle rule
      deleting files after 30 days, add the secrets, then run the workflow once by hand
      (Actions → Daily database backup → Run workflow).
- [ ] **Restore drill** (do once before launch, then every few months):
  1. Download the newest `daily/todo-*.dump` from the bucket.
  2. Create an empty database (a new Railway Postgres, or locally).
  3. `pg_restore --no-owner --no-privileges -d "<empty database URL>" todo-<date>.dump`
  4. Point a staging API at it and sign in. (Checked locally on 24 Nov 2026: users, tasks and
     groups came back intact.)
- Recordings and photos live in R2, not the database. Turn on R2 bucket versioning or a second
  copy if losing them would matter.

## 4. Quality gates (in CI on every push)

- Lint, types, 178 unit/API tests, 39 browser tests on a phone and a desktop screen with axe
  accessibility checks (light, dark, Hindi), Lighthouse (performance, accessibility, best
  practices), API Docker build.
- [ ] **(you)** Try the app with TalkBack (Android) or VoiceOver (iPhone) on the main flows,
      and on a cheap Android phone on a slow connection.

## 5. Known gaps (decided or deferred)

- **Speech-to-text** is not in the MVP (decision of 18 Nov). Voice notes have no transcript,
  so deaf or hard-of-hearing users can't follow voice-only messages. Recordings are labelled
  with who and how long; the `transcript` columns are ready for when a provider is added
  (Sarvam AI or Google Chirp 3 were the candidates).
- **iPhone push** only works after "Add to Home Screen" (an Apple rule). Settings explains this.
- **Offline**: text tasks, ticking done/undo and text comments queue offline; editing a task and
  recording need a connection (the app says so).
- **Simple mode** is switched on per person in Settings (a family member can do it on their
  phone). Admins can't switch it on for someone remotely.
