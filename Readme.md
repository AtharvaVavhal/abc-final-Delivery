<div align="center">

# PrintForge

**Custom printing, engineered like infrastructure.**

[![Architecture](https://img.shields.io/badge/architecture-frozen%20v1.2-black)]()
[![Backend](https://img.shields.io/badge/backend-implemented-brightgreen)]()
[![Frontend](https://img.shields.io/badge/frontend-implemented-brightgreen)]()
[![Tests](https://img.shields.io/badge/e2e-%C2%A727%20suite%20passing-brightgreen)]()
[![Deployment](https://img.shields.io/badge/deployment-live-blue)]()
[![License](https://img.shields.io/badge/license-proprietary-black)]()

</div>

---

## Overview

PrintForge is a modular commerce platform for custom printing. It takes a customer from product discovery through file upload, checkout, payment, production, and delivery — with every state transition enforced at the database layer, not assumed by application code.

The system is built as a **modular monolith**: one deployable backend, twelve clean domain boundaries, and PostgreSQL as the single source of truth for correctness. There are no microservices, no message brokers, and no distributed infrastructure the current scale doesn't justify. Reliability comes from transactions, constraints, and idempotency — not from additional moving parts.

This README documents the frozen architecture and the actual implementation state against it. See [Project Status](#project-status) for the honest line between "designed" and "shipped."

---

## Contents

- [Product Experience](#product-experience)
- [Architecture](#architecture)
- [Payment Architecture](#payment-architecture)
- [Checkout Consistency](#checkout-consistency)
- [Coupons](#coupons)
- [Order Lifecycle](#order-lifecycle)
- [Webhook Reliability](#webhook-reliability)
- [Transactional Outbox](#transactional-outbox)
- [Database Architecture](#database-architecture)
- [Security](#security)
- [Technology Stack](#technology-stack)
- [Repository Structure](#repository-structure)
- [API Surface](#api-surface)
- [Local Development](#local-development)
- [Development Workflow](#development-workflow)
- [Reliability / Failure Matrix](#reliability--failure-matrix)
- [Tax & GST](#tax--gst)
- [Project Status](#project-status)

---

## Product Experience

```
Discover → Customize → Upload → Cart → Coupon → Checkout → Payment → Production → Shipping → Delivery → Review
```

**Customer-facing capabilities**

| Area | Capability |
|---|---|
| Catalog | Browse categories, products, and variants |
| Customization | Configure per-product customization fields |
| Uploads | Attach artwork/files to customized items |
| Cart | Manage line items and customizations pre-checkout |
| Coupons | Apply a code at checkout; see the discount before paying |
| Checkout | Convert a cart into an immutable order |
| Payment | Pay via Razorpay, retry on failure |
| Orders | Track status from payment through delivery |
| Reviews | Rate and review a product after delivery, from the order that proves the purchase |
| Notifications | Receive transactional emails on key events |

**Admin capabilities**

| Area | Capability |
|---|---|
| Catalog management | Products, categories, variants, customization fields |
| Order management | View orders, transition status, inspect payment history, record refunds |
| Coupon management | Create and edit coupons; usage limits and scope are set once and immutable |
| Review moderation | Approve or reject reviews inline from the product they belong to |
| Customers | Read-only customer list and detail with order/spend context |
| Dashboard | Order counts, revenue, and recent-order summary |

---

## Architecture

**Status: frozen at Blueprint v1.2.** See [`docs/architecture/BLUEPRINT-v1.2.md`](./docs/architecture/BLUEPRINT-v1.2.md) for the canonical specification. This README is a summary; the blueprint is the source of truth. Coupons and Reviews were added under [`docs/architecture/PHASE-10-PROPOSAL.md`](./docs/architecture/PHASE-10-PROPOSAL.md), the project's first formal Architecture Change Request against the frozen blueprint.

### Principles

- **Database-enforced correctness.** Invariants that matter (uniqueness, one-captured-payment-per-order, idempotent writes) are enforced by PostgreSQL constraints, not application-level checks alone.
- **Explicit transaction boundaries.** Multi-step business operations (checkout, coupon redemption, webhook processing) execute inside a single transaction or are decomposed into safe, resumable phases.
- **Idempotency by default.** Any operation that can be retried, double-clicked, or redelivered is designed to be safe when it happens twice.
- **Recoverability over cleverness.** Failure states are first-class: `FAILED`, `PROCESSING_FAILED`, `ABANDONED` are real, queryable states — not swallowed exceptions.
- **Simple infrastructure.** PostgreSQL and a scheduled poller replace a queue where a queue is not yet justified.
- **Frozen architecture, evolving code.** Structural decisions are versioned and deliberate; implementation details are not.

### System Diagram

```mermaid
flowchart LR
    subgraph Client
        Web["React SPA"]
    end
    subgraph Backend["NestJS Modular Monolith"]
        Auth[Auth]
        Catalog[Products / Categories]
        Cart[Cart]
        Checkout[Checkout]
        Coupons[Coupons]
        Payments[Payments]
        Orders[Orders]
        Reviews[Reviews]
        Admin[Admin]
        Outbox[Outbox Poller]
    end
    DB[(PostgreSQL)]
    RZP[Razorpay]
    CLD[Cloudinary]
    RSD[Resend]
    Web -->|REST + JWT| Backend
    Auth --> DB
    Catalog --> DB
    Cart --> DB
    Checkout --> DB
    Coupons --> DB
    Payments --> DB
    Orders --> DB
    Reviews --> DB
    Admin --> DB
    Outbox --> DB
    Checkout -->|Create Order| RZP
    Checkout -->|Claim, per-user + total limits| Coupons
    Payments -->|Verify / Webhook| RZP
    Catalog -->|Public delivery| CLD
    Catalog -->|Signed delivery, customer uploads| CLD
    Outbox -->|Send email| RSD
```

---

## Payment Architecture

An **Order** has one-to-many **PaymentAttempts**. A single Razorpay Order ID is created per application Order and reused across retries — PrintForge never creates a new application Order for a retried payment.

```
Order 1 ──< PaymentAttempt N
             ├─ INITIATED
             ├─ CAPTURED   (at most one per order)
             ├─ FAILED     (any number)
             └─ ABANDONED
```

**Enforced invariants**

| Constraint | Enforced by |
|---|---|
| At most one `CAPTURED` attempt per order | Partial unique index: `orderId WHERE status = 'CAPTURED'` |
| No two attempts share a Razorpay payment | Unique index on `razorpayPaymentId` |
| One Razorpay Order ID per application Order | Set-once column update, `WHERE razorpayOrderId IS NULL` |

Multiple failed or abandoned attempts against the same order are expected and harmless — the partial index only ever gates the state that matters.

---

## Checkout Consistency

Checkout is designed to be safe under double-clicks, duplicate requests, and partial failures.

```mermaid
sequenceDiagram
    participant C as Client
    participant API as Checkout Module
    participant DB as PostgreSQL
    participant RZP as Razorpay
    C->>API: POST /checkout/orders (Idempotency-Key)
    API->>DB: BEGIN
    API->>DB: SELECT cart FOR UPDATE
    API->>DB: INSERT idempotency key ON CONFLICT
    API->>DB: Revalidate products, recompute price
    API->>DB: Claim coupon (CAS), if present
    API->>DB: INSERT order, order_items, snapshots
    API->>DB: Save idempotency → orderId
    API->>DB: Clear cart
    API->>DB: COMMIT
    API->>RZP: Create Razorpay Order
    RZP-->>API: razorpayOrderId
    API->>DB: UPDATE orders SET razorpayOrderId WHERE NULL
    API-->>C: Order created
```

The database transaction commits **before** PrintForge talks to Razorpay. This is deliberate: the order's existence never depends on an external API call succeeding. If Razorpay order creation fails, the order remains valid in `PENDING_PAYMENT`, and `POST /checkout/orders/:id/retry-payment` repeats only the association step — not the entire checkout.

The cart lock (`FOR UPDATE`) is the first statement in the transaction, and it does double duty: it's what makes two different tabs racing on the same cart collapse into one order, *and* it's what makes a per-user coupon usage limit safe to check without a second lock — by the time the coupon claim runs, this user's checkout is already fully serialized.

### Order Shipping Snapshot

Shipping details are copied onto the `orders` row at creation time — there is no separate `order_address_snapshots` table. Once written, these fields are immutable:

```
shippingRecipientName   shippingAddressLine2   shippingPostalCode
shippingPhone           shippingCity           shippingCountry
shippingAddressLine1    shippingState
```

A customer editing their saved address afterward has no effect on historical orders — the order already owns its own copy. The same immutable-snapshot pattern applies to a coupon: `orders.couponCode` and `orders.discountAmount` are copied at checkout, so a coupon edited or deactivated later never rewrites the price of an order that already used it.

---

## Coupons

A coupon is one of three types — `PERCENTAGE`, `FLAT_AMOUNT`, or `FREE_SHIPPING` — optionally scoped to a single category, and optionally bounded by a total usage limit, a per-user usage limit, a minimum order value, a date window, or a first-order-only restriction.

Redeeming a coupon is a compare-and-swap, the same pattern the idempotency-key check uses:

```sql
UPDATE coupons
SET "usedCount" = "usedCount" + 1
WHERE id = $couponId
  AND "isActive" = true
  AND (window and eligibility conditions...)
  AND ("usageLimitTotal" IS NULL OR "usedCount" < "usageLimitTotal")
RETURNING id
```

Zero rows returned means the coupon is exhausted or no longer eligible — the checkout fails cleanly with a `409`, never an overdraw of the limit. Under concurrent load (five simultaneous requests against a coupon with one use left, in the e2e suite), exactly one succeeds and the rest are correctly rejected, with exactly one `coupon_usages` row and one order carrying the discount.

Coupon fields that define its identity — `code`, `type`, `percentageOff`, `flatAmountOff`, `scopeType`, `categoryId` — are set once at creation and are not editable afterward; only limits, the date window, the active flag, and an admin-internal description can change. The admin UI reflects this structurally: the edit form never renders those fields, rather than rendering and disabling them.

---

## Order Lifecycle

```
PENDING_PAYMENT → PAID → CONFIRMED → IN_PRODUCTION → SHIPPED → DELIVERED
                                    ↘ CANCELLED
                                    ↘ REFUNDED
```

Status changes are applied as conditional, compare-and-set database updates: `UPDATE orders SET status = $next WHERE id = $id AND status = $expectedCurrent`. Re-applying a transition that has already been applied is a no-op, not an error — this makes admin double-clicks safe. A transition attempted from an unexpected state returns:

```
409 INVALID_TRANSITION
```

Business order state (above) is intentionally decoupled from payment-infrastructure state (`PaymentAttempt` status, webhook status) — the two lifecycles are related but not the same state machine. A product review can only be written from an order line item whose order has reached `DELIVERED` — the review's "verified purchase" guarantee is anchored to a real `orderItemId`, not just account ownership.

---

## Webhook Reliability

Webhook handling is split into two phases so that acknowledging Razorpay is never blocked on business logic.

**Phase 1 — Ingest**
1. Capture the raw request body (required for signature verification).
2. Verify the Razorpay webhook signature.
3. Persist the event with a unique `razorpayEventId`.
4. Acknowledge Razorpay immediately.

**Phase 2 — Process**
1. Load the persisted, unprocessed event.
2. Update the relevant `PaymentAttempt`.
3. Update the `Order` if required.
4. Write `order_status_history`.
5. Insert an `outbox_events` row in the same transaction.
6. Mark the webhook `PROCESSED`.

```
RECEIVED → PROCESSED
         ↘ PROCESSING_FAILED  (retried by scheduled poller)
         ↘ IGNORED            (duplicate / not actionable)
```

The unique `razorpayEventId` constraint means a redelivered webhook is detected at ingest and cannot produce duplicate side effects. Processing failures are picked up by the same scheduled polling mechanism used for the outbox — no separate retry infrastructure. Webhook delivery order is **not** guaranteed by Razorpay, and PrintForge does not claim otherwise: payment-state updates are written as idempotent, state-checked writes rather than assumed to arrive in sequence.

---

## Transactional Outbox

Notifications are decoupled from business transactions using a PostgreSQL-native outbox — no Redis, Kafka, or RabbitMQ.

The event row is inserted in the **same transaction** as the state change it describes, so a committed business event and its notification record can never disagree.

```
PENDING → PROCESSING → SENT
                      ↘ FAILED   (after 5 attempts, terminal)
```

A scheduled NestJS poller claims work with `SELECT ... FOR UPDATE SKIP LOCKED`, so multiple instances can run the poller safely without duplicate claims. Failed sends retry with exponential backoff, tracked via `lastError` and `availableAt`, up to 5 attempts before landing in the terminal `FAILED` state for manual inspection.

**Event types:** `ORDER_PAID` · `ORDER_STATUS_CHANGED` · `PASSWORD_RESET_REQUESTED`
**Provider:** Resend

Email delivery failure never rolls back or corrupts order or payment state — the outbox is downstream of truth, not a dependency of it. There is one accepted edge case: if the process crashes between the provider accepting an email and the outbox row being marked `SENT`, the event is retried and the customer may receive a rare duplicate email. This is treated as acceptable — silently losing a notification is worse than an occasional duplicate.

---

## Database Architecture

```
users, refresh_tokens
categories, products, product_images, product_variants, customization_fields
uploaded_files
carts, cart_items, cart_item_customizations
coupons, coupon_usages
orders, order_items, order_item_customizations, order_status_history
reviews
payment_attempts, webhook_events, idempotency_keys, outbox_events
app_settings
```

There is intentionally no `payments` table. It was replaced early in design by `payment_attempts`, which models the real relationship between an order and the (possibly several) attempts made to pay for it.

### Data Integrity

Constraints exist because the failure modes they prevent are worse than the friction they add. Each one maps to a concrete scenario, not a generic best practice:

| Constraint | Prevents |
|---|---|
| `users.email` unique | Duplicate accounts / login ambiguity |
| `products.slug` unique | Colliding public product URLs |
| `categories.slug` unique | Colliding public category URLs |
| `orders.orderNumber` unique | Ambiguous customer-facing order references |
| `orders.razorpayOrderId` unique | Two orders sharing one payment session |
| `payment_attempts.razorpayPaymentId` unique | Recording the same Razorpay payment twice |
| Partial unique: one `CAPTURED` attempt per order | Double-charging or double-crediting a single order |
| `webhook_events.razorpayEventId` unique | Redelivered webhooks re-executing side effects |
| `outbox_events.eventKey` unique | A business event enqueuing more than one notification |
| `idempotency_keys.key` unique | A retried checkout request creating a second order |
| `coupons.code` unique | Two coupons resolving to the same code |
| `reviews` unique on (`orderItemId`) | The same delivered line item reviewed twice |

The common thread: every one of these encodes a "this must never happen twice" rule directly into the schema, so correctness does not depend on every code path remembering to check.

---

## Security

**Authentication**
- Short-lived JWT access tokens, held client-side in memory only — never `localStorage` or `sessionStorage`.
- Refresh tokens delivered as an HttpOnly, Secure cookie: `SameSite=Strict`, `Path=/api/v1/auth/refresh`.
- Refresh-token rotation on every use.
- Refresh-token reuse detection — a reused (already-rotated) token revokes the entire session chain.
- Logout and logout-all via `tokenVersion` invalidation.

**Login protection**
- IP-based throttling (`@nestjs/throttler`).
- Progressive delay after repeated failures.
- No hard account lockout, no CAPTCHA in the current phase — a failed login remains a standard authentication failure, not a distinguishable locked state.

**Input integrity**
- Every DTO is validated with `class-validator`, and the global `ValidationPipe` runs with `whitelist: true, forbidNonWhitelisted: true` — a request carrying a field the DTO doesn't declare (e.g. a client-supplied `discountAmount` on a checkout request) is rejected with a `400` before it reaches any handler. Field tampering is structurally unreachable, not just filtered.

**Transport & CORS**
- CORS restricted to the deployed frontend origin, credentials enabled — never a wildcard, enforced in production `NODE_ENV`.
- Standard security headers (CSP, HSTS, X-Frame-Options, and related) applied platform-wide via Helmet.
- Errors are reported to Sentry when configured, scrubbed of request bodies and sensitive payloads before leaving the process.

### File Upload Security

Accepted formats: **PNG, JPEG, PDF**. Archive formats are not accepted, and the server never extracts or decompresses uploaded content.

| Control | Purpose |
|---|---|
| Magic-byte validation | Detect actual file type, not just extension |
| MIME/type validation | Reject mismatched or spoofed content types |
| 10 MB size limit, enforced on the stream | Bound resource usage before the full file lands |
| No archive extraction, no server-side decompression | Eliminate zip-bomb / archive-based attack surface |
| No unnecessary server-side parsing | Cloudinary handles media processing, not the API |
| Delivery type by purpose | Product catalog images are public and CDN-cacheable; customer file uploads are signed and access-gated |
| Ownership verification on `uploadedFileId` | Prevent one user from referencing another user's file |
| Per-user / per-IP upload rate limits | Bound abuse of the upload endpoint |
| Orphan cleanup | Remove files uploaded but never attached to an order |

---

## Technology Stack

**Frontend**
React · TypeScript · Vite · React Router · TanStack Query · Axios · React Hook Form · Zod · CSS Modules · CSS Variables · Vitest + React Testing Library

**Backend**
NestJS · TypeScript · Prisma · PostgreSQL · REST + JSON · JWT · bcrypt · `class-validator` · `@nestjs/schedule` · `@nestjs/throttler` · `@sentry/node` · Jest (unit + e2e)

**Integrations**
Razorpay (payments) · Cloudinary (media) · Resend (transactional email) · Sentry (error tracking)

**CI/CD**
GitHub Actions — every pull request runs backend lint, build, unit tests, and the full e2e suite against a real Postgres service container, and frontend lint, typecheck, build, and unit tests, independently.

**Production topology**

| Layer | Host | Status |
|---|---|---|
| Backend | Render | Deployed |
| Frontend | Vercel | Deployed |
| Database | Render PostgreSQL | Live |

A custom domain (`printforge.in`) has not been cut over yet — see [Project Status](#project-status).

---

## Repository Structure

```
PrintForge/
├── backend/                       # NestJS + Prisma API
│   ├── src/
│   │   ├── auth/ users/ products/ cart/ checkout/
│   │   ├── coupons/ payments/ orders/ reviews/
│   │   ├── uploads/ notifications/ admin/
│   │   └── common/
│   ├── prisma/
│   └── test/e2e/                  # §27 release suite — one spec per concern
├── frontend/                      # React + TypeScript SPA
│   └── src/
│       ├── pages/ features/ hooks/ services/api/
│       └── schemas/ types/
├── docs/
│   └── architecture/
│       ├── BLUEPRINT-v1.2.md      # Canonical architecture specification
│       └── PHASE-10-PROPOSAL.md   # ACR: Coupons + Reviews
├── .github/workflows/ci.yml
├── .gitignore
└── README.md
```

---

## API Surface

| Domain | Responsibility |
|---|---|
| `/health` | Liveness and DB-connectivity probes |
| `/auth` | Register, login, logout, token refresh, password reset |
| `/users` | Authenticated user's own profile |
| `/products` | Product catalog reads |
| `/categories` | Category catalog reads |
| `/uploads` | File uploads (product images, customization artwork) |
| `/cart` | Cart and cart item management |
| `/checkout` | Order creation, coupon validation/preview, payment retry |
| `/payments` | Payment verification and webhook ingestion |
| `/orders` | Customer order reads and cancellation |
| `/reviews` | Product reviews — create, edit, delete a verified-purchase review |
| `/admin` | Product, category, order, coupon, and customer administration; review moderation |

**Notable endpoints**

```
GET    /health/deep
POST   /checkout/validate
POST   /checkout/orders
POST   /checkout/orders/:id/retry-payment
POST   /payments/verify
POST   /payments/webhook
POST   /auth/login
PATCH  /admin/orders/:id/status
PATCH  /admin/coupons/:id
PATCH  /admin/reviews/:id/status
```

`payment_attempts` has no standalone REST resource — it is exposed only as contextual, read-only data nested within order responses. `outbox_events` and `webhook_events` have no public API; they are internal reliability mechanisms.

---

## Local Development

```bash
# clone
git clone https://github.com/AtharvaVavhal/PrintForge.git
cd PrintForge

# backend
cd backend
cp .env.example .env
npm install
npx prisma generate
npx prisma migrate dev
npm run start:dev

# frontend, in a second terminal
cd frontend
cp .env.example .env
npm install
npm run dev
```

### Environment Configuration

The values below are for local development. For the full per-variable matrix
(required in dev / test / production, purpose, where each is provisioned) see
[`docs/ops/ENVIRONMENT.md`](./docs/ops/ENVIRONMENT.md). In production
(`NODE_ENV=production`) the backend fails fast at boot if a production-critical
variable is missing.

**`backend/.env`**
```env
NODE_ENV=development
PORT=4000
FRONTEND_URL=http://localhost:5173
BACKEND_URL=http://localhost:4000
DATABASE_URL=postgresql://user:password@localhost:5432/printforge?schema=public
JWT_ACCESS_SECRET=
JWT_ACCESS_EXPIRES_IN=15m
REFRESH_TOKEN_SECRET=
REFRESH_TOKEN_EXPIRES_IN=30d
ADMIN_REFRESH_TOKEN_EXPIRES_IN=12h
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
RESEND_API_KEY=
EMAIL_FROM_ADDRESS=no-reply@printforge.in
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
# Optional — Sentry.init is guarded by this; unset is a valid no-op locally
SENTRY_DSN=
```

**`frontend/.env`**
```env
VITE_API_BASE_URL=http://localhost:4000/api/v1
VITE_RAZORPAY_KEY_ID=
```

### Running the e2e suite

The `test/e2e` suite runs supertest against a real Nest app and a real Postgres database — not mocks. See [`backend/test/e2e/support/README.md`](./backend/test/e2e/support/README.md) for the one-time setup (a `printforge_test`-suffixed database, migrated, plus a `backend/.env.test`).

```bash
cd backend
npm run test:e2e
```

---

## Development Workflow

Feature branches only — no direct commits to `main` or `develop`.

```
feature/<owner>/<area>
fix/<owner>/<short-description>
```

```
Branch → Implement → Typecheck → Lint → Test → e2e → Build → Pull Request → CI → Review → Merge
```

### Architecture Freeze

Blueprint v1.2 is frozen. Code implementing it can evolve freely; the structural decisions it encodes cannot change silently. Any proposed architecture change follows a fixed path:

```
Problem → Impact Analysis → Review → Approval → Blueprint Update (ACR) → Implementation
```

Coupons and Reviews (§10) are the first change to go through this path in full, documented in `PHASE-10-PROPOSAL.md`.

---

## Reliability / Failure Matrix

| Scenario | Behavior |
|---|---|
| Checkout double-click | Second request hits `idempotency_keys` conflict, returns the original order |
| Simultaneous checkout requests | Cart `FOR UPDATE` lock serializes them |
| Concurrent coupon redemption at the usage limit | Compare-and-swap claim allows exactly one winner; the rest fail `409`, never overdrawing the limit |
| Razorpay order creation fails | Order stays valid, `PENDING_PAYMENT`; retry endpoint repeats only the association step |
| Frontend crash after payment | Webhook independently reconciles order state |
| Webhook arrives before frontend verification | Webhook processing applies the state; frontend verification becomes a no-op confirmation |
| Frontend verification arrives before webhook | Verification applies the state; webhook later confirms/no-ops |
| Duplicate webhook delivery | Blocked by unique `razorpayEventId` |
| Webhook processing failure | Marked `PROCESSING_FAILED`, retried by scheduled poller |
| Email provider failure | Outbox retries with backoff; order/payment state unaffected |
| Refresh-token replay | Reuse detection revokes the session |
| Unauthorized `uploadedFileId` reference | Ownership check rejects it |
| Address changed after order placed | Order retains its immutable shipping snapshot |
| Coupon edited or deactivated after use | Past orders retain their immutable `couponCode` / `discountAmount` snapshot |
| Admin double-click on status change | Conditional update is a no-op on the second click |
| Invalid order transition | `409 INVALID_TRANSITION` |
| Review attempted on a non-delivered or unowned order item | Rejected — verified-purchase check fails |
| Retrying payment after a failed attempt | New `PaymentAttempt` row; same Order, same Razorpay Order ID |
| Database connectivity lost | `/health/deep` reports it distinctly from process-alive `/health`, so a transient DB blip doesn't trigger a platform restart-loop |

---

## Tax & GST

GST treatment is a business and legal decision, not an engineering one. PrintForge does not assume, infer, or hard-code any GST rate, invoicing requirement, or filing obligation. The pricing engine is structured so GST handling can be introduced once the following are confirmed by the business:

- Whether GST applies to the platform's transactions.
- Whether GST-compliant invoices must be generated.
- Applicable rate(s) and rule(s).
- GSTIN / HSN / SAC requirements, if any.

Nothing in this repository should be read as tax or legal guidance.

---

## Project Status

Only the architecture is frozen; everything below reflects actual implementation state, not intent.

**Backend — implemented.** All twelve domains (`auth`, `users`, `products`, `uploads`, `cart`, `checkout`, `coupons`, `payments`, `orders`, `reviews`, `notifications`, `admin`) are built against the frozen blueprint plus the Phase 10 ACR, with real business logic, not stubs. The full §27 release-test list — covering checkout idempotency, concurrency, security/tampering, auth security, payment races, order status transitions, and upload validation — passes against a real Postgres database in `backend/test/e2e/`.

**Frontend — implemented.** The full customer flow (catalog through checkout, coupon application, order tracking, reviews) and the full admin flow (catalog, orders, customers, coupons, review moderation) are built.

**CI — in place.** A GitHub Actions workflow runs backend and frontend lint, build, and test independently on every pull request; the backend job runs the full e2e suite against a real Postgres service container.

**Deployed.** Backend is live on Render, frontend is live on Vercel, both wired to real Razorpay test-mode credentials, Cloudinary, and a production Postgres instance.

**Remaining before this is a finished launch:** a full live smoke test of the payment flow end to end (checkout → Razorpay test payment → webhook → order status update), production (not test-mode) Razorpay credentials, Resend configured for real transactional email, and DNS cutover to `printforge.in` for both the frontend and backend so the refresh-cookie's `SameSite` behavior matches the architecture's registrable-domain assumption.

---

## Operations

Operational runbooks live in [`docs/ops/`](./docs/ops/):

| Document | Purpose |
|---|---|
| [`ENVIRONMENT.md`](./docs/ops/ENVIRONMENT.md) | Every backend/frontend env var — required-when, purpose, format, provisioning. Backend boot fails fast on missing production-critical variables (`NODE_ENV=production`). |
| [`DEPLOYMENT.md`](./docs/ops/DEPLOYMENT.md) | Pre-deploy checklist, Prisma migration procedure, deploy + rollback, incident basics (payments / webhooks / email). |
| [`BACKUP-RESTORE.md`](./docs/ops/BACKUP-RESTORE.md) | Database backup responsibility, RPO/RTO assumptions, restore procedure — documented, not yet drilled. |
| [`PRODUCTION-SMOKE-TEST.md`](./docs/ops/PRODUCTION-SMOKE-TEST.md) | Post-deploy checklist across infra, auth, commerce, payment, email, admin, upload, security. |
| [`DEPENDENCY-ADVISORIES.md`](./docs/ops/DEPENDENCY-ADVISORIES.md) | Known `npm audit` findings and CI policy. |

---

## Team

Maintained by the PrintForge engineering team.

---

## License

Proprietary. All rights reserved. This repository and its contents are not licensed for external use, reproduction, or distribution without written permission.

---

<div align="center">

**PrintForge** · Custom printing, engineered like infrastructure.

</div>
