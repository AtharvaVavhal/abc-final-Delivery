# Deployment & Rollback Runbook

**Status: DOCUMENTED** (not yet executed against live production infra from
this repo). Topology is frozen — see [`README.md`](./README.md).

- Backend → Render (Node web service), one instance
- Frontend → Vercel (static site)
- Database → Render PostgreSQL
- Deploy trigger → git push to `develop`/`main` (auto-deploy) or manual "Deploy" in the dashboard
- No containers, no IaC manifests in the repo — do not invent them

---

## 1. Pre-deployment checklist

- [ ] CI is green on the commit being deployed (backend + frontend + hygiene jobs).
- [ ] `git diff --check` clean; no `.env` or secret files staged (`git status`).
- [ ] All Tier-2 production env vars set in Render (see [`ENVIRONMENT.md`](./ENVIRONMENT.md)). A missing one now **fails boot** with a named error — that is intended.
- [ ] `FRONTEND_URL` / `BACKEND_URL` in Render match the real production hostnames (drives CORS + webhook URL).
- [ ] `VITE_API_BASE_URL` in Vercel points at the production backend `+ /api/v1`.
- [ ] New Prisma migrations (if any) reviewed for destructive operations (column/table drops, type narrowing, non-nullable additions without defaults).
- [ ] Razorpay dashboard webhook points at `{BACKEND_URL}/api/v1/payments/webhook` with the same secret as `RAZORPAY_WEBHOOK_SECRET`.
- [ ] Resend sending domain verified; `EMAIL_FROM_ADDRESS` on that domain.
- [ ] Fresh database backup / snapshot taken (see [`BACKUP-RESTORE.md`](./BACKUP-RESTORE.md)) — especially before a migration.
- [ ] Note the currently-deployed commit SHA (for rollback).

## 2. Required environment variables

See [`ENVIRONMENT.md`](./ENVIRONMENT.md). Summary of what MUST be present in
production: `NODE_ENV=production`, `PORT`, `DATABASE_URL`,
`JWT_ACCESS_SECRET`, `REFRESH_TOKEN_SECRET`, `RAZORPAY_KEY_ID`,
`RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_SAAS_KEY_ID`,
`RAZORPAY_SAAS_KEY_SECRET`, `RAZORPAY_SAAS_WEBHOOK_SECRET`,
`PAYMENT_CREDENTIALS_MASTER_KEY`, `CLOUDINARY_CLOUD_NAME`,
`CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `RESEND_API_KEY`,
`EMAIL_FROM_ADDRESS`, `FRONTEND_URL`, `BACKEND_URL`. `SENTRY_DSN` recommended.

## 3. Database backup / check

Before every deploy that includes a migration:

1. Trigger / confirm a Render PostgreSQL backup (or `pg_dump` to secure storage).
2. Record the backup identifier + timestamp in the deploy notes.
3. Confirm connectivity: `GET {BACKEND_URL}/api/v1/health/deep` returns `200`.

## 4. Prisma migration procedure

Migrations are applied with **`prisma migrate deploy`** (never `migrate dev`
in production — it can generate/rename migrations).

- **Recommended:** run as a Render *pre-deploy command* or release step:
  `npm run prisma:migrate:deploy`
- If run manually, do it from a shell with the **production** `DATABASE_URL`
  immediately before promoting the new backend build:
  ```
  cd backend
  npm ci
  npm run prisma:generate
  npm run prisma:migrate:deploy
  ```
- `prisma migrate deploy` only applies migrations already committed under
  `backend/prisma/migrations/`. It does not prompt and does not create new
  migrations.
- The seed script (`backend/prisma/seed.ts`) is a **stub** — production
  catalog/category data and the admin user are created through the running
  app, not seeded (see step 6 / step 8).

## 5. Backend deployment (Render)

**Root Directory:** `backend`

1. Push to the deploy branch, or click **Manual Deploy → Deploy latest commit**.
2. Render build: `npm ci --include=dev && npx prisma generate && npm run build`.
3. Start command: `npx prisma migrate deploy && npm run start:prod`.
   (`migrate deploy` is forward-only and applies already-committed migrations;
   it does not prompt, reset, or push schema.)
4. Boot-time env validation runs first. **If a required production variable is
   missing the process exits with `Environment validation failed: <VAR> is
   required in production`** — fix the env var and redeploy; the old instance
   keeps serving until the new one is healthy.
5. Health check path: `/api/v1/health` (HTTP 200, `{success:true,data:{status:"ok",...}}`).
6. Wait for Render health check to pass.

`DATABASE_URL` must be the Render PostgreSQL **Internal Database URL**.
`FRONTEND_URL` must be the real Vercel/custom-domain origin (no trailing slash).
It is compared with `BACKEND_URL` to set the refresh cookie SameSite (`Strict`
when they share a site; `None; Secure` when they do not, e.g. Vercel ↔ Render).
Razorpay webhook: `{BACKEND_URL}/api/v1/payments/webhook`.

## 6. Frontend deployment (Vercel)

1. Push to the deploy branch, or **Redeploy** in the Vercel dashboard.
2. Build: `npm run build` (`tsc -b && vite build`) with `VITE_*` from the
   Vercel project settings.
3. `robots.txt` / `sitemap.xml` are emitted at build time from `VITE_SITE_URL`
   (or the default `https://www.printforge.in`).
4. Vercel promotes the new deployment atomically; rollback is instant (step 10).

## 7. Health checks

| Check | Expectation |
|---|---|
| `GET {BACKEND_URL}/api/v1/health` | `200 {"success":true,"data":{"status":"ok","timestamp":"..."}}` — process is up |
| `GET {BACKEND_URL}/api/v1/health/deep` | `200` — DB reachable; `503` with generic `"Service unavailable"` if not |
| `GET {FRONTEND_URL}/` | `200`, SPA shell loads |

## 8. Smoke checks

Run the full [`PRODUCTION-SMOKE-TEST.md`](./PRODUCTION-SMOKE-TEST.md)
checklist. Minimum before declaring a deploy good:

- Both health endpoints green.
- Storefront loads; a product detail page renders.
- Log in as an existing admin; the admin dashboard loads.
- (First deploy only) promote the first admin — no admin exists until a
  registered user's `role` is set to `ADMIN` directly in the database
  (`UPDATE users SET role='ADMIN' WHERE email='...'`, or via Prisma Studio
  against production). Registration always creates `CUSTOMER`.

## 9. Post-deployment verification

- [ ] Health + deep-health green for 5+ minutes.
- [ ] No new error spike in Sentry.
- [ ] One real (small) checkout → payment → webhook → order `PAID` → invoice, if live payments are enabled (see [`PRODUCTION-SMOKE-TEST.md`](./PRODUCTION-SMOKE-TEST.md) §Payment).
- [ ] One transactional email received (order confirmation).
- [ ] `webhook_events` rows advance to `PROCESSED`/`IGNORED` (not stuck `RECEIVED`, not piling up in `FAILED`); `outbox_events` rows reach `SENT`.
- [ ] Deploy notes updated: new SHA, previous SHA, migration ids applied, backup id.

## 10. Rollback procedure

**Frontend (Vercel):** dashboard → Deployments → previous good deployment →
**Promote to Production**. Instant, no build.

**Backend (Render):** dashboard → Events / Deploys → previous good deploy →
**Rollback** (redeploys that image). Or push a revert commit.

**Order of operations matters when a migration was applied:**

1. If the new code is bad but the migration is backward-compatible (additive
   only): roll back the backend image; the old code ignores the new
   columns/tables. Safe.
2. If the migration itself is the problem: see §11 — you generally cannot
   "un-migrate" cleanly. Restore from the pre-deploy backup
   ([`BACKUP-RESTORE.md`](./BACKUP-RESTORE.md)) and roll back the backend.
3. Never leave new backend code running against an old schema.

## 11. Database migration rollback limitations

- Prisma has **no down-migrations**. `prisma migrate deploy` is forward-only.
- Reverting a migration means either:
  - writing and applying a new compensating migration, or
  - restoring the database from the backup taken in step 3.
- Therefore: **always take a backup before a migration**, and prefer
  additive/backward-compatible migrations so a code-only rollback is possible
  without touching the schema.
- Destructive migrations (drops, non-nullable-without-default, type
  narrowing) should be split across two deploys (expand → migrate data →
  contract) whenever the table is non-trivial.

## 12. Incident basics

1. **Assess blast radius:** checkout down? payments? email only? admin only?
2. **Check health:** `/health` (process) vs `/health/deep` (DB) isolates
   app-crash vs DB-outage.
3. **Check Sentry** for the error signature and first-seen time; correlate
   with the last deploy.
4. **Decide:** roll back (fastest safe fix) vs hotfix-forward.
5. **Communicate** status to the business owner; note customer impact
   (failed orders, un-sent emails — both are recoverable, see below).
6. **Write up** afterwards: trigger, timeline, fix, follow-ups.

## 13. Where logs / errors are checked

| Source | What it shows |
|---|---|
| Render → service → **Logs** | Nest application logs (structured lines), boot errors, cron job logs (`PaymentReconciliationService`, `WebhookProcessor`, `OutboxPoller`) |
| Sentry | Unhandled exceptions and explicitly-captured errors (if `SENTRY_DSN` set) |
| Vercel → project → **Logs** / **Deployments** | Frontend build failures, static serving |
| Razorpay dashboard → **Webhooks** | Delivery attempts, response codes, retries from Razorpay's side |
| Database (`webhook_events`, `outbox_events`, `payment_attempts`, `order_status_history`) | Ground truth for payment/email/order-state processing |

## 14. If payments fail

- **Symptom: customer pays, order stays `PENDING_PAYMENT`.**
  - The `PaymentReconciliationService` cron (every 5 min) independently
    queries Razorpay and will move the order to `PAID` (or `PAYMENT_FAILED`)
    without manual action — wait one cycle first.
  - Check `payment_attempts` for the order: a `CAPTURED` row means money was
    taken; `INITIATED` only means an attempt started.
  - Check Razorpay dashboard for the payment id and its status.
- **Symptom: `verify` endpoint 4xx for everyone.** Likely `RAZORPAY_KEY_SECRET`
  wrong/missing — HMAC verification fails. Fix env, redeploy.
- **Symptom: no Razorpay order created (`razorpayOrderId` null).**
  `RAZORPAY_KEY_ID`/`SECRET` invalid, or Razorpay API unreachable. Reconciliation
  will fail such orders as stale after the timeout.
- **Never** manually flip `order.status` to `PAID` without a confirmed
  `CAPTURED` payment attempt and a matching Razorpay payment.
- **Refunds are manual** via the Razorpay dashboard. A status transition to
  `REFUNDED` records a `PENDING` row in `refunds` for audit only; it does not
  move money.

## 15. If webhooks stop processing

- Check `webhook_events`: rows stuck in `RECEIVED` (not being picked up) vs
  `FAILED` (dead-lettered after the retry budget) vs `PROCESSING_FAILED`
  (transient, will retry after `availableAt`).
- The `WebhookProcessor` cron runs every 30 s. If nothing is advancing, the
  backend process or its scheduler is down → check Render logs for the app
  and for "ScheduleModule".
- `FAILED` (dead-letter) rows: inspect `lastError`. `AMOUNT_MISMATCH` /
  `CURRENCY_MISMATCH` / `RAZORPAY_ORDER_ID_MISMATCH` are **non-retryable by
  design** (tampered or wrong payload) — investigate, do not blindly retry.
- Reconciliation is the safety net: even with webhooks fully down, paid
  orders are reconciled within ~5 min from Razorpay directly.
- Verify the Razorpay dashboard webhook URL and secret still match
  `BACKEND_URL` and `RAZORPAY_WEBHOOK_SECRET` (a domain cutover breaks this).

## 16. If email delivery fails

- Transactional email is dispatched by the `OutboxPoller` cron (every 30 s)
  from `outbox_events`. Undelivered mail is **not lost** — rows stay and are
  retried.
- Check `outbox_events` for rows not reaching `SENT` (stuck `PENDING` /
  `PROCESSING`, or `FAILED`); `lastError` names the cause.
- Common causes: `RESEND_API_KEY` invalid/missing, `EMAIL_FROM_ADDRESS` not
  on a verified Resend domain, Resend rate limit / outage.
- Fix the config and redeploy; the poller drains the backlog automatically.
- Email failure never blocks checkout or order state — orders complete
  regardless.
