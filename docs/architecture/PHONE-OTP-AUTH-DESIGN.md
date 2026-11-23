# Phone OTP login for customers — design proposal

**Status: APPROVED — implementation starting (backend first, behind a feature
flag that defaults to off).** All open questions are resolved (see §11).
Touches the frozen auth area (BLUEPRINT-v1.2 §17/§23), so this must be approved
first. SMS provider: **MSG91** (owner decision).

## 2026-11-23 implementation clarification

The owner confirmed in the login-redesign task that AB CREATIONS uses
**Renflair WhatsApp OTP**, supplied `https://renflair.in/wp-otp.php` and the
`TEST-WHATSAPP-OTP-PHP-SCRIPT.zip` example. This supersedes the MSG91 provider
choice below for this storefront. Renflair only delivers; generation and
verification remain server-side. No sample credentials are imported.

The current P9-D1 legacy `User` model remains in use. OTP identities now carry
an immutable store binding; challenges are store-bound; verified domain routing
and membership refusal are checked at issuance, refresh and access validation.
Thin JWTs, refresh cookies and RLS remain. This is a constrained legacy bridge,
not the deferred store-scoped `Customer` migration. The existing global unique
phone can belong to only one store; cross-store use is refused. Existing unbound
phone accounts and email-only accounts need an audited reconciliation/claim
flow before general cut-over. See `AB-CREATIONS-LOGIN-REDESIGN.md` for release
requirements and validation. The historical proposal below is retained.

## 1. Goal

Let customers sign in and check out with a mobile number + SMS code instead of
registering with email and password. Remove the "register before add-to-cart"
wall. Staff (admin, superadmin) keep email + password, unchanged.

## 2. Current state (from the code)

- `User`: `email` unique and required, `passwordHash` required, `phone` optional
  and unused for login. A separate store-scoped `Customer` model exists in the
  schema (also `email` + `passwordHash` required). **Open question Q1: which of
  the two the live storefront actually authenticates against.**
- `AuthService`: register, login, refresh (rotating refresh tokens with replay
  detection, HMAC-keyed `tokenHash`), logout, logout-all, password reset.
  `@ThrottleAuth()` rate limiting on the sensitive routes.
- No SMS provider exists. Email goes through Resend via the outbox.
- `/cart` and `/checkout` sit behind a route guard (login required).

## 3. Proposed flow

1. Customer enters a 10-digit Indian mobile number.
2. `POST /auth/otp/request {phone}` → server creates an OTP challenge and sends
   the SMS through MSG91. Response is always the same (no account enumeration).
3. Customer enters the 6-digit code.
4. `POST /auth/otp/verify {phone, code}` → on success: find-or-create the
   customer by phone, then issue the **same access token + rotating refresh
   cookie** the password login issues today. Nothing downstream changes
   (cart, checkout, orders, refresh, logout all work as now).
5. First login asks (optionally) for name and email for receipts.

## 4. Data model (additive migration)

- `User` gains `phone` (E.164, normalised `+91XXXXXXXXXX`),
  **unique** per store/tenant, plus `phoneVerifiedAt`.
- `email` becomes optional (nullable, still unique when present);
  `passwordHash` becomes optional for customers (phone-only accounts).
  Staff rows keep both required in application logic. Existing rows are
  untouched by the migration.
- New table `otp_challenges`: `id`, `phone`, `codeHash` (HMAC, never the raw
  code), `expiresAt`, `attempts`, `consumedAt`, `createdAt`, `requestIp`,
  tenant/store ids. Short-lived; purged by the existing scheduled jobs.

## 5. Where the code is generated and checked

**Recommendation: generate and verify the OTP ourselves; use MSG91 only to
deliver the SMS.**

- We control expiry, attempt limits and tests, and are not tied to MSG91's
  verify endpoint. The code is stored only as a keyed hash, consistent with how
  refresh tokens are handled (`hashRefreshToken`).
- Alternative: MSG91's own OTP send/verify API. Less code, but verification
  state lives outside our DB and is harder to test and rate-limit. Rejected
  unless the owner prefers it.
- Put the provider behind a small `SmsProvider` interface with an `Msg91`
  implementation and a console/no-op implementation for dev and tests. MSG91
  request/response details must be **verified against MSG91's current docs and
  the account's DLT template before implementation** — they are not assumed here.

## 6. Security rules

- Code: 6 digits, CSPRNG, valid 5 minutes, single use.
- Max 5 verify attempts per challenge, then the challenge is dead.
- Rate limits: per phone (e.g. 3 sends / 15 min, 10 / day), per IP, and a global
  daily SMS ceiling that alerts and then stops sending. This is the SMS-pumping
  / bill-abuse defence and is not optional.
- Identical responses for known and unknown numbers.
- Resend cooldown of 30–60 seconds, enforced server-side.
- Add CAPTCHA/BotID on `/otp/request` if abuse is observed.
- All existing session protections are reused (refresh rotation, replay
  detection, `tokenVersion`).
- Staff accounts cannot sign in via OTP.
- Never log the code or the full phone number.

## 7. MSG91 and DLT prerequisites (owner / ops — start now)

Required before any SMS can be delivered in India:

1. MSG91 account and auth key.
2. Business entity registered on a DLT platform (e.g. Jio/Airtel/Vodafone-Idea
   portals) — takes days to weeks.
3. Registered **sender ID (header)** and an approved **OTP template** with the
   variable for the code.
4. Template ID configured in MSG91.
5. Environment variables (names proposed): `MSG91_AUTH_KEY`,
   `MSG91_OTP_TEMPLATE_ID`, `MSG91_SENDER_ID`; plus `OTP_HMAC_SECRET`.
   Document them in `docs/ops/ENVIRONMENT.md`.

Costs are per SMS and vary; confirm the current rate with MSG91.

## 8. Migration of existing accounts (affected by the Q5 decision)

Decision: **customers sign in with OTP only; no customer passwords.** So
existing email+password customer accounts cannot simply keep working.

- An existing customer **with a phone number on file** logs in by OTP to that
  number and lands in their existing account (orders and history preserved).
  The number must be normalised to `+91XXXXXXXXXX` and checked for duplicates
  across accounts first.
- An existing customer **without a phone number** (the `phone` column is
  optional today) cannot be matched by OTP. They need a one-time claim path:
  verify via the email on the account (reset-style link), then add and verify a
  phone number. This is the open question Q6.
- After a cut-over date, customer password login and customer password reset
  are removed. Staff keep email + password.
- Before building: count production customers with and without a phone number
  (read-only query) to size this.

## 9. Frontend changes

- Login/register page: phone field → code field, with resend timer and clear
  error states. No email+password option for customers; staff use their own
  login page.
- Remove the route guard from cart; cart stays usable by a guest (separate
  item — guest cart) and login is requested at checkout.
- Staff login page unchanged.

## 10. Rollout plan

1. Owner approves this design and answers the questions below.
2. Ops completes MSG91 + DLT (can run in parallel with step 3).
3. Backend: migration, `SmsProvider`, OTP endpoints, tests (including abuse
   limits and replay of a used code). Ship with the feature flag **off**.
4. Frontend OTP screens behind the same flag.
5. Test end to end with a real number on staging; enable for customers.
6. Run the existing-account claim path (§8), then remove customer password
   login and password reset at the cut-over date.

## 11. Decisions and remaining questions

Resolved:

- **Q1 (User vs Customer):** `User` — confirmed from the code.
- **Q2 (WhatsApp OTP):** yes, as a later addition. SMS via MSG91 first; the
  `SmsProvider` interface leaves room for a WhatsApp channel.
- **Q4 (verified email):** not required now. Email is optional and
  unverified; email verification is a later phase.
- **Q5 (customer passwords):** removed. Customers use OTP only.

- **Q3 (daily SMS ceiling):** confirmed — default **500 sends per day**,
  configurable via env var, alert at 80%.
- **Q6 (existing customers without a phone):** confirmed — one-time email-link
  claim path (§8) before customer password login is removed.
