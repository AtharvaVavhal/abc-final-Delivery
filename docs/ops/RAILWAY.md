# Railway deployment (backend + Postgres)

Frontend stays on Vercel (Root Directory `frontend`). Railway runs only the Nest API and Postgres.

The repo root is the deploy unit: `package.json` builds and starts `backend/`, `railway.toml` sets the start command and healthcheck, `nixpacks.toml` pins Node 22 + OpenSSL. Leave Railway's Root Directory empty.

## 1. Create services

1. New Project, then Deploy from GitHub repo (this repo).
2. Add a Postgres plugin to the same project.

## 2. Backend variables

Set on the backend service. Missing production-required keys fail boot with a named error.

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (reference variable, internal URL) |
| `JWT_ACCESS_SECRET` | generated (below) |
| `REFRESH_TOKEN_SECRET` | generated (below), different from the access secret |
| `PAYMENT_CREDENTIALS_MASTER_KEY` | generated (below), base64 of exactly 32 bytes |
| `FRONTEND_URL` | `https://www.abcmanufactures.com` |
| `BACKEND_URL` | `https://api.abcmanufactures.com` |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | merchant commerce keys |
| `RAZORPAY_SAAS_KEY_ID`, `RAZORPAY_SAAS_KEY_SECRET`, `RAZORPAY_SAAS_WEBHOOK_SECRET` | SaaS billing keys (separate from the three above) |
| `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS` | sender must be on a Resend-verified domain |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Cloudinary account |
| `SENTRY_DSN` | optional |

Boot only checks that these are non-blank. Test-mode Razorpay keys are enough to get the service healthy; payments need real keys.

Generate the three secrets:

```
echo "JWT_ACCESS_SECRET=$(openssl rand -hex 32)"
echo "REFRESH_TOKEN_SECRET=$(openssl rand -hex 32)"
echo "PAYMENT_CREDENTIALS_MASTER_KEY=$(openssl rand -base64 32)"
```

Do not set `PORT` (Railway injects it). Do not set any `SEED_*` variables on the service.

## 3. Deploy and domain

- Healthcheck: `/api/v1/health`, timeout 300s (first boot runs all Prisma migrations).
- Add the custom domain `api.abcmanufactures.com` to the backend service and create the DNS record Railway shows. The refresh cookie is `SameSite=Strict` and needs the storefront and API on the same site (`www.` and `api.` under `abcmanufactures.com`).

## 4. Seed the empty database (from your Mac)

A fresh DB has no tenant, so the storefront returns "Unable to determine which store". Seed once.

```
cd backend
npm ci
```

Create `backend/.env` (gitignored) containing only:

```
DATABASE_URL=<Postgres plugin DATABASE_PUBLIC_URL>
```

Do not set `NODE_ENV=production` in the shell; the bootstrap refuses it.

```
SEED_TENANT_SLUG=ab-creations SEED_STORE_NAME='AB Creations' \
SEED_OWNER_EMAIL=<admin email> SEED_OWNER_PASSWORD=<strong password> \
npx ts-node prisma/seed-tenant-bootstrap.ts

npx ts-node prisma/seed-ab-creations-categories.ts
```

Products: `prisma/seed-production.ts` creates a sample catalog through the live API (`SEED_API_BASE_URL=https://api.abcmanufactures.com/api/v1`). Use the Identica/UVPixel seed scripts instead if that was the real catalog.

Delete `backend/.env` when done.

## 5. Frontend and webhooks

- Vercel: set `VITE_API_BASE_URL=https://api.abcmanufactures.com/api/v1` and `VITE_SITE_URL=https://www.abcmanufactures.com`, then redeploy (build-time variables).
- Razorpay merchant webhook: `{BACKEND_URL}/api/v1/payments/webhook`.
- Razorpay SaaS billing webhook: `{BACKEND_URL}/api/v1/webhooks/billing`.

## 6. Verify

- `GET /api/v1/health` returns 200; `GET /api/v1/health/deep` confirms Postgres.
- Storefront loads categories, admin login works.
- Test-mode checkout reaches paid status through the webhook.
