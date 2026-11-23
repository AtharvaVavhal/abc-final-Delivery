# AB CREATIONS premium WhatsApp OTP login

Implemented locally on 2026-11-23. **Not deployed; no production migrations or live credentials changed.** The existing frontend rollout flag remains off by default. Real Renflair delivery has not been tested in this task.

## Audit and decisions

- Entry: `frontend/src/pages/auth/LoginPage.tsx`; existing OTP component: `frontend/src/features/auth/OtpSignIn.tsx`; route chrome: `frontend/src/layouts/RootLayout.tsx`.
- Existing OTP endpoints, provider abstraction, cryptographic generation, HMAC storage, refresh cookies and JWT sessions were reused. No authentication library or UI framework added.
- Reviewed `docs/saas/DECISIONS.md`, especially P9-D1, and `PHONE-OTP-AUTH-DESIGN.md`. The approved current storefront authenticates the legacy global `User`; the future store-scoped `Customer`/customer-token migration is deferred. This implementation preserves that boundary and thin JWT format. It restricts each OTP identity to one store through database state. It does not support independent identities for the same phone in multiple stores; that requires the deferred identity migration.
- The owner explicitly selected **Renflair WhatsApp OTP** in this task, superseding the older MSG91 proposal for AB CREATIONS. Checked the existing adapter against the supplied `TEST-WHATSAPP-OTP-PHP-SCRIPT.zip` (`send-otp.php`). Endpoint: `https://whatsapp.renflair.in/V1.php`; GET parameters: `API`, national `PHONE`, `OTP`, `COUNTRY=91`. No key from the sample was copied, configured or used. The provider page supplied was https://renflair.in/wp-otp.php; its body was not readable by the research tool, so the local supplied sample was the contract evidence.
- Renflair remains delivery-only. The PHP sample's session-based verification and OTP echoing are not used. Existing MSG91 adapters are retained for compatibility; they are not the default or required for AB CREATIONS.
- Only the lamp photograph was attached, not a SNITCH screenshot. Layout follows the written composition specification.

## Visual result

- Full viewport 50/50 desktop composition, supplied lamp photograph, bottom text overlay, pure black authentication area, 396px charcoal card, supplied white-and-amber primary logo, underlined phone/code entry and white 56px action button.
- Dark logo is copied byte-for-byte from `ab-creations-logo-set/ab-creations-primary-horizontal-dark.svg`. No derivative or colour filter.
- Photo source preserved in `product-images/login-portrait-lamp.png`; reproducible AVIF/WebP variants at 640, 960 and 1440px. Largest AVIF is approximately 118KB. No photo request on mobile. Image dimensions prevent layout shift.
- Hero hidden at widths up to 768px; safe-area padding and natural scrolling when the keyboard reduces available height. Short desktop uses contained photography to preserve the whole lamp/base, with the tagline below the product.
- Legal links use existing `ROUTES.TERMS` (`/terms`) and `ROUTES.PRIVACY` (`/privacy`). No storefront header, footer, sidebar or WhatsApp floating control on OTP login.
- OTP uses a single labelled six-digit field with paste/autofill, numeric keyboard, focus management, errors announced as alerts, explicit verification action, masked recipient, change-number control, loading protection and a resend timer. Timer is feedback; PostgreSQL enforces resend limits.
- Existing `?method=password`, registration/recovery fallback while the flag is off, admin and superadmin flows are retained. Admin redirects explicitly select password sign-in. Intended checkout path and query are preserved; unsafe redirect paths are refused.

## API and security changes

No new route names or response formats:

| Endpoint / boundary | Change |
| --- | --- |
| `POST /api/v1/auth/otp/request` | Resolve an active store/tenant from a VERIFIED registered domain; atomically reserve send quota; bind challenge and HMAC to store. Returns existing 204 only after provider accepts delivery. |
| `POST /api/v1/auth/otp/verify` | Verify latest store-specific challenge, then create/find the global phone identity idempotently; refuse inactive users, staff, platform admins, tenant memberships, wrong-store and unbound legacy phone identities. Existing token/cookie response retained. |
| `POST /api/v1/auth/refresh` | Revalidate OTP identity's store/membership restrictions. Compare-and-set prevents concurrent rotation from issuing multiple successors. Existing reuse detection remains. |
| Bearer JWT validation | Revalidate database store binding; derive storefront tenant context server-side without adding tenant claims to JWTs. Cross-store access and tenant-header overrides fail closed. Password users retain their existing path. |

Host resolution does not use a newest-tenant fallback. The configured `BACKEND_URL` hostname maps to the configured `FRONTEND_URL` hostname's verified StoreDomain; other request hostnames must have their own verified StoreDomain. Domain tenant/store ownership must agree. No body/header tenant ID establishes identity. Existing RLS helpers and policies remain; the existing auth allowlist now explicitly inventories these queries.

OTP policy: CSPRNG six digits, five-minute expiry, HMAC-SHA256 with separate secret, five attempts, single use, 30-second cooldown, three sends per 15 minutes per phone, ten per rolling day per phone, twenty per hour per IP, configurable global daily cap (default 500). Short PostgreSQL advisory-lock transactions enforce quota and verification across API instances. Provider network I/O happens outside transactions. A resend permanently supersedes old codes; consumed/expired/exhausted newer rows cannot uncover an older valid code. Failed delivery consumes the challenge while retaining its rate-limit accounting.

No OTP values are logged, including by the development delivery sink. Renflair redirects are refused and delivery errors are sanitized. Its existing adapter accepts only an explicit successful JSON status. Its upstream query contains key/code/phone by provider contract: do not record outgoing request URLs in access logs, tracing or APM. No frontend secrets, cookie relaxation, CORS relaxation or cart-clearing behavior was added.

## Migration

New migration: `backend/prisma/migrations/20261123130000_otp_store_binding/migration.sql`.

Adds nullable `users.otpStoreId` and `otp_challenges.storeId`. No historical identity is silently attributed to a store. Existing unbound challenges fail closed. No schema backfill, unique-key replacement or RLS-policy change. The earlier `20261123120000_phone_otp_auth` migration is a prerequisite.

Applied only to **localhost `abc_clone_test`** for controlled tests, guarded by a script that refuses nonlocal/non-test targets. Not applied to the development or production databases. Migration-safety guard passes. Production migration and deployment remain separate approval steps.

## Configuration and Renflair setup

Frontend: `VITE_AUTH_OTP_ENABLED=true` at build time, coordinated with backend activation. The default remains off to avoid cutting off existing password customers before reconciliation. Local visual preview was launched with this flag via environment only; no live/local credential files were edited.

Backend:

```dotenv
AUTH_OTP_ENABLED=true
OTP_SMS_PROVIDER=renflair
OTP_HMAC_SECRET=<independent-strong-random-secret>
RENFLAIR_API_KEY=<server-side-Renflair-account-key>
RENFLAIR_BASE_URL=https://whatsapp.renflair.in
OTP_DAILY_SEND_CAP=500
FRONTEND_URL=https://www.abcmanufactures.com
BACKEND_URL=https://api.abcmanufactures.com
```

`renflair` is now the provider default if unspecified. Set it explicitly in deployment for clarity. Existing explicitly configured providers are respected. Never use `console` in production: startup validation refuses it. The current local backend was configured with the console test sink; it was not switched to live delivery.

Before activation, operations must verify that the mapped StoreDomain belongs to the real AB CREATIONS tenant/store and is VERIFIED. Do not create guessed IDs or use a tenant browser parameter. Use the existing domain-verification workflow.

Renflair delivery is an owner-selected service, not a newly recommended SMS vendor. Confirm the account's India WhatsApp delivery, sender, exact message wording, balance and current pricing, rate limits, availability, terms and data handling directly with Renflair. No verified price/SLA/compliance representation is made here. Run an authorized staging send to a real WhatsApp-enabled Indian phone and complete verification/refresh/logout through the actual domains before calling delivery ready. No MSG91 account, SMS template or MSG91 credentials are required for this selected adapter.

## Release limits

- Existing email-only customers and unbound legacy OTP users require the approved audited reconciliation/email-proof claim flow before broad cut-over. Automatically attaching an unverified profile phone could expose old orders, so this implementation does not do that. The login feature flag prevents a premature cut-over. Returning already-bound OTP customers keep the same account and cart.
- A global phone is bound to one store in this legacy bridge; independent identities for the same phone across stores remain a future Customer-model migration.
- API proxy must preserve the intended trusted host and overwrite untrusted forwarded host headers as expected by the existing one-hop trust-proxy setup.
- PostgreSQL-backed rate limits and verification have been tested locally; Renflair network/delivery, production domain records, credentials and production infrastructure have not been tested or modified.
- No full live-commerce Playwright suite was run: its existing harness writes to a real delivery database. The added Playwright suite intercepts every API request and is explicitly a UI contract test, not a delivery test.

## Validation

See the results below. Browser screenshots are under `frontend/e2e/screenshots/otp-*`; they use mocked API responses and synthetic codes only. Keyboard, focus, errors, labels and responsive behavior were checked; no external accessibility scanner or physical mobile keyboard/real-device certification is claimed.

| Check | Result |
| --- | --- |
| Backend Nest production build | Passed |
| Frontend production build with `VITE_AUTH_OTP_ENABLED=true` | Passed |
| Focused Vitest auth, auth pages, redirects and breakpoint guard | **71 passed** |
| Focused Jest OTP/provider, environment, tenant context, migration safety and access allowlist | **238 passed** |
| Local PostgreSQL OTP + existing auth-security, checkout-security, admin-control-plane e2e | **60 passed**, including **16 OTP cases** |
| Playwright isolated UI contract suite | **8 passed**; 320, 375, 390, 768, 1024, 1440px, keyboard/focus, safe legal links, hidden mobile imagery, 50/50 desktop, loading flow, masked recipient, cooldown, checkout redirect, short-height layouts |
| Full frontend Vitest | **927 passed, 3 failed** across 125 files |
| Full backend Jest | **1412 passed, 1 failed** across 99 suites |
| Whitespace / patch integrity | `git diff --check` passed |

The four full-suite failures are existing seller-identity expectations, unrelated to login: frontend `Header.test.tsx` (one) and `AdminSettingsPage.test.tsx` (two), backend `app-setting.constants.spec.ts` (one). Tests expect `Identica` while current seller defaults use `GOURAV KUMAR ABHAY SINGH`. Those source and test files were verified byte-for-byte against HEAD and were not changed. They remain a separate baseline issue; this task does not claim a wholly green repository.

The older live-commerce Playwright harness was intentionally not run against its configured delivery database. No real Renflair messages were sent. Provider tests use controlled responses; backend e2e uses an injected delivery spy and real local PostgreSQL. Screenshots demonstrate layout, not successful upstream delivery.

Reproduce from the corresponding package directory:

```sh
# frontend (the Playwright config expects a local OTP-enabled Vite on port 5180)
npm test -- --run src/features/auth src/pages/auth src/styles/breakpoints.test.ts
VITE_AUTH_OTP_ENABLED=true npm run build
VITE_AUTH_OTP_ENABLED=true npm run dev -- --host 127.0.0.1 --port 5180 --strictPort
npx playwright test --config playwright.otp.config.ts

# backend; e2e .env.test must target only an isolated *_test database
npm run build
npm test -- --runInBand auth/otp common/tenant/tenant-context.guard.spec.ts common/config/env.validation.spec.ts migration-safety.spec.ts tenant-data-access-guard.spec.ts
npm run test:e2e -- --runInBand phone-otp-auth.e2e-spec.ts auth-security.e2e-spec.ts checkout-security.e2e-spec.ts admin-control-plane.e2e-spec.ts
```

## Files changed

Paths below include source, tests, migration, documentation, optimized assets and visual evidence. The owner's pre-existing untracked `ab-creations-logo-set/` was only read; it is excluded from this list.

- `backend/.env.example`
- `backend/prisma/migrations/20261123130000_otp_store_binding/migration.sql`
- `backend/prisma/schema.prisma`
- `backend/src/auth/auth.controller.ts`
- `backend/src/auth/auth.service.ts`
- `backend/src/auth/otp/otp.service.spec.ts`
- `backend/src/auth/otp/otp.service.ts`
- `backend/src/auth/otp/sms/console-sms.provider.ts`
- `backend/src/auth/otp/sms/renflair.provider.ts`
- `backend/src/auth/strategies/jwt.strategy.ts`
- `backend/src/common/config/configuration.ts`
- `backend/src/common/config/env.validation.spec.ts`
- `backend/src/common/config/env.validation.ts`
- `backend/src/common/decorators/current-user.decorator.ts`
- `backend/src/common/tenant/tenant-context.guard.spec.ts`
- `backend/src/common/tenant/tenant-context.guard.ts`
- `backend/src/common/tenant/tenant-context.ts`
- `backend/src/tenant-data-access-guard.spec.ts`
- `backend/test/e2e/phone-otp-auth.e2e-spec.ts`
- `docs/architecture/AB-CREATIONS-LOGIN-REDESIGN.md`
- `docs/architecture/PHONE-OTP-AUTH-DESIGN.md`
- `docs/ops/ENVIRONMENT.md`
- `frontend/.env.example`
- `frontend/e2e/otp-login.spec.ts`
- `frontend/e2e/screenshots/otp-login-1024.png`
- `frontend/e2e/screenshots/otp-login-1440.png`
- `frontend/e2e/screenshots/otp-login-320.png`
- `frontend/e2e/screenshots/otp-login-375.png`
- `frontend/e2e/screenshots/otp-login-390.png`
- `frontend/e2e/screenshots/otp-login-768.png`
- `frontend/e2e/screenshots/otp-verify-1440.png`
- `frontend/e2e/screenshots/otp-verify-390.png`
- `frontend/playwright.otp.config.ts`
- `frontend/public/brand/ab-creations/login/logo-dark.svg`
- `frontend/public/brand/ab-creations/login/portrait-lamp-1440.avif`
- `frontend/public/brand/ab-creations/login/portrait-lamp-1440.webp`
- `frontend/public/brand/ab-creations/login/portrait-lamp-640.avif`
- `frontend/public/brand/ab-creations/login/portrait-lamp-640.webp`
- `frontend/public/brand/ab-creations/login/portrait-lamp-960.avif`
- `frontend/public/brand/ab-creations/login/portrait-lamp-960.webp`
- `frontend/scripts/optimize-login-image.mjs`
- `frontend/src/features/auth/AdminRoute.tsx`
- `frontend/src/features/auth/OtpLoginShell.module.css`
- `frontend/src/features/auth/OtpLoginShell.tsx`
- `frontend/src/features/auth/OtpSignIn.module.css`
- `frontend/src/features/auth/OtpSignIn.test.tsx`
- `frontend/src/features/auth/OtpSignIn.tsx`
- `frontend/src/features/auth/postAuthDestination.test.ts`
- `frontend/src/features/auth/postAuthDestination.ts`
- `frontend/src/layouts/RootLayout.tsx`
- `frontend/src/pages/auth/LoginPage.tsx`
- `product-images/login-portrait-lamp.png`
