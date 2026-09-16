# Environment Variables

Authoritative list of every environment variable PrintForge reads, and when
each is required.

- **Boot enforcement:** `backend/src/common/config/env.validation.ts`.
  - Tier 1 (always): fails boot in **every** environment if missing/blank.
  - Tier 2 (`PRODUCTION_REQUIRED_KEYS`): fails boot **only when `NODE_ENV=production`**.
- Development and test (`NODE_ENV` = `development` / `test`) run fine with all
  Tier-2 variables unset — no Razorpay / Cloudinary / Resend network call is
  reachable in those environments (see `.github/workflows/ci.yml` and
  `backend/test/e2e/support/`).
- Validation error messages name the **variable only**, never a value.
- **Never commit real values.** `backend/.env`, `frontend/.env`, and any
  `.env.*` (except `*.env.example`) are git-ignored.

---

## Backend

| Variable | Dev | Test | Prod | Purpose | Example format | Provisioned in |
|---|:---:|:---:|:---:|---|---|---|
| `NODE_ENV` | ✅ | ✅ | ✅ | Runtime mode. Must be `development`, `test`, or `production`. Gates Tier-2 validation, throttler skip, Sentry environment tag. | `production` | Render service env |
| `PORT` | ✅ | ✅ | ✅ | HTTP listen port. Integer 1–65535. | `4000` | Render (injected) |
| `DATABASE_URL` | ✅ | ✅ | ✅ | PostgreSQL connection string. On Render use the **Internal Database URL** (same private network as the web service). Do not log or commit this value. | `postgresql://USER:PASS@HOST:5432/DB?schema=public` | Render PostgreSQL add-on |
| `JWT_ACCESS_SECRET` | ✅ | ✅ | ✅ | HMAC secret for short-lived access tokens. Use a long random string. | 32+ random bytes, base64/hex | Render service env (secret) |
| `JWT_ACCESS_EXPIRES_IN` | — | — | — | Access-token TTL. Defaults to `15m`. | `15m` | Render service env (optional) |
| `REFRESH_TOKEN_SECRET` | ✅ | ✅ | ✅ | Secret for the opaque DB-backed refresh token. **This is the name the code reads** — there is no `JWT_REFRESH_SECRET`. Distinct from the access secret. | 32+ random bytes | Render service env (secret) |
| `REFRESH_TOKEN_EXPIRES_IN` | — | — | — | Refresh-token / cookie lifetime. Defaults to `30d`. | `30d` | Render service env (optional) |
| `RAZORPAY_KEY_ID` | ⬜ | ⬜ | ✅ | Razorpay API key id. `rzp_test_*` in dev, `rzp_live_*` in production. Also returned to the browser per checkout. | `rzp_live_XXXXXXXXXXXXXX` | Render service env |
| `RAZORPAY_KEY_SECRET` | ⬜ | ⬜* | ✅ | Razorpay API key secret. Signs/verifies payment HMAC. | opaque string (secret) | Render service env (secret) |
| `RAZORPAY_WEBHOOK_SECRET` | ⬜ | ⬜* | ✅ | Verifies the `X-Razorpay-Signature` header on `POST /api/v1/payments/webhook`. | opaque string (secret) | Render service env (secret) **and** Razorpay dashboard webhook config |
| `RAZORPAY_SAAS_KEY_ID` | ⬜ | ⬜ | ✅ | Razorpay API key id for PrintForge's **own SaaS subscription billing** (Merchant → PrintForge → Razorpay Subscriptions) — a distinct account/key pair from the merchant-commerce `RAZORPAY_KEY_ID` above, never reused between the two. `rzp_test_*` in dev, `rzp_live_*` in production. | `rzp_live_XXXXXXXXXXXXXX` | Render service env |
| `RAZORPAY_SAAS_KEY_SECRET` | ⬜ | ⬜ | ✅ | Razorpay API key secret for SaaS subscription billing. Signs/verifies SaaS billing API requests. Distinct from `RAZORPAY_KEY_SECRET` (merchant commerce) — never reused. | opaque string (secret) | Render service env (secret) |
| `RAZORPAY_SAAS_WEBHOOK_SECRET` | ⬜ | ⬜ | ✅ | Verifies the `X-Razorpay-Signature` header on `POST /api/v1/webhooks/billing` (SaaS subscription billing webhooks only). Distinct from `RAZORPAY_WEBHOOK_SECRET` (merchant commerce, `POST /api/v1/payments/webhook`) — never reused. | opaque string (secret) | Render service env (secret) **and** Razorpay dashboard webhook config (SaaS account) |
| `PAYMENT_CREDENTIALS_MASTER_KEY` | ⬜ | ⬜ | ✅ | AES-256-GCM master key for merchant `PaymentAccount` credentials. Base64, must decode to exactly 32 bytes (`openssl rand -base64 32`). Production refuses to boot if missing or malformed. | base64 32-byte key | Render service env (secret) |
| `RESEND_API_KEY` | ⬜ | ⬜ | ✅ | Resend API key for transactional email dispatch (outbox poller). | `re_XXXXXXXX` (secret) | Render service env (secret) |
| `EMAIL_FROM_ADDRESS` | ⬜ | ⬜ | ✅ | `From:` address for all transactional email. Must be on a Resend-verified domain in production. | `no-reply@printforge.in` | Render service env |
| `CLOUDINARY_CLOUD_NAME` | ⬜ | ⬜ | ✅ | Cloudinary account cloud name (product image storage/delivery). | `printforge` | Render service env |
| `CLOUDINARY_API_KEY` | ⬜ | ⬜ | ✅ | Cloudinary API key. | numeric string | Render service env |
| `CLOUDINARY_API_SECRET` | ⬜ | ⬜ | ✅ | Cloudinary API secret (signs upload/delete). | opaque string (secret) | Render service env (secret) |
| `FRONTEND_URL` | ✅** | ✅** | ✅ | Exact storefront origin (no trailing slash). Sole CORS allowed origin (`credentials: true`, never a wildcard). Must be **same-site** with `BACKEND_URL` so the `SameSite=Strict` refresh cookie is sent (custom domain, e.g. `https://www.example.com` + `https://api.example.com`). A `*.vercel.app` frontend with a `*.onrender.com` API is cross-site and will not send the cookie. | `https://www.printforge.in` | Render service env |
| `BACKEND_URL` | ✅** | ✅** | ✅ | Public API origin. Used for absolute links and the Razorpay webhook URL `{BACKEND_URL}/api/v1/payments/webhook`. | `https://api.printforge.in` | Render service env |
| `POSTAL_LOOKUP_BASE_URL` | — | — | ⬜ | PIN-code lookup provider. Defaults to `https://api.pincodeapi.in/api/v1`. | URL | Render service env (optional) |
| `SENTRY_DSN` | — | — | ⬜ recommended | Error tracking. `Sentry.init` is a **no-op when unset** — intentionally *not* enforced so error reporting can never block boot. | `https://xxx@oyyy.ingest.sentry.io/zzz` | Render service env |

Legend: ✅ required · ⬜ optional (has a safe empty default) · — not applicable / has a hard-coded default
\* CI's generated `.env.test` **does** set `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` to dummy values because `payments-race.e2e-spec.ts` exercises the real local HMAC path (no network call).
\** `FRONTEND_URL` / `BACKEND_URL` have `localhost` defaults in `configuration.ts` for dev convenience; they are Tier-2 (production-enforced) so a prod deploy cannot silently fall back to `localhost` CORS.

### Render service settings

Set **Root Directory** to `backend`. Render injects `PORT`; set `NODE_ENV=production`.

| Step | Command |
|---|---|
| Build | `npm ci --include=dev && npx prisma generate && npm run build` |
| Start | `npx prisma migrate deploy && npm run start:prod` |
| Health check | `GET /api/v1/health` (process up). Optional readiness: `GET /api/v1/health/deep` (Postgres reachable). |

`--include=dev` is required so `@nestjs/cli` (build) is installed even when Render sets `NODE_ENV=production` during `npm ci`. `prisma` is a production dependency so `migrate deploy` works at start. Never use `prisma migrate reset`, `prisma db push`, or `prisma migrate dev` against production. Do not run `prisma:seed` or `prisma:seed:tenant-bootstrap` on Render — bootstrap refuses `NODE_ENV=production`, and the live catalog already exists.

### Not environment-configurable

- Throttler limits are static in `app.module.ts` / `common/throttling/` (default 60/60s, with stricter auth and more generous public-read overrides).
- Cron cadence is fixed in each `@Cron` decorator.
- Cookie name/path (`pf_refresh_token`, `/api/v1/auth/refresh`) are constants.

---

## Frontend

Vite inlines `VITE_*` variables at **build time**. They are baked into the
static bundle — never put a secret in one.

| Variable | Dev | Prod build | Purpose | Example |
|---|:---:|:---:|---|---|
| `VITE_API_BASE_URL` | ✅ | ✅ | Base URL of the backend API (includes `/api/v1`). | `https://api.printforge.in/api/v1` |
| `VITE_SITE_URL` | — | ⬜ | Public site origin for SEO canonical URLs, `og:url`, JSON-LD, `robots.txt`, `sitemap.xml`. Defaults to `https://www.printforge.in` when unset. Set for staging/preview hosts. | `https://printforge-staging.example.com` |
| `VITE_RAZORPAY_KEY_ID` | ⬜ | ⬜ | Public Razorpay key id. **Currently not read** by the app — checkout uses the `razorpayKeyId` returned per `retry-payment` call. Kept for future use. | `rzp_live_XXXXXXXXXXXXXX` |

Provisioned in the Vercel project's Environment Variables (Production /
Preview / Development scopes).

---

## Pending business configuration (not env vars — admin settings)

These are stored in `app_settings` and edited via the admin **Store settings**
page, not the environment. They ship blank on purpose and must be supplied by
the business before GST-compliant operation. See
[`../architecture/`](../architecture/) and the Tax & GST section of the root
`Readme.md`.

| Setting key | Meaning | State |
|---|---|---|
| `tax.enabled` | Master GST switch | `false` |
| `tax.ratePercent` | Combined GST rate | blank — **pending client/accountant** |
| `tax.pricingMode` | INCLUSIVE (locked; EXCLUSIVE rejected server-side) | `INCLUSIVE` |
| `invoice.numberPrefix` | Invoice number prefix / statutory format | `INV-` — pending confirmation |
| `invoice.sellerLegalName` | Registered business name on invoices | blank — pending |
| `invoice.sellerAddress` | Registered business address | blank — pending |
| `invoice.sellerGstin` | Business GSTIN | blank — pending |
| `invoice.sellerState` | Place-of-supply state | blank — pending |

CGST/SGST/IGST split (`Order.taxBreakdown`) stays `null` until place-of-supply
rules are confirmed. **Do not enable GST with guessed values.**
