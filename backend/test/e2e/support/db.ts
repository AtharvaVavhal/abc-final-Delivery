import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';

/**
 * Every @@map'd table in prisma/schema.prisma (kept in sync manually —
 * there's no dev-time signal if a new model is added and this list isn't
 * updated, so a new model shows up as leftover rows between tests rather
 * than a hard failure). TRUNCATE...CASCADE means listing every table is
 * belt-and-suspenders, not strictly required for FK ordering, but it's
 * what actually gets emptied between tests, so completeness matters.
 */
const ALL_TABLES = [
  'users',
  'refresh_tokens',
  // Phone-OTP login challenges — no FK to users, so TRUNCATE users CASCADE
  // would NOT empty it; it must be listed.
  'otp_challenges',
  'categories',
  'products',
  'product_images',
  'product_variants',
  'customization_fields',
  'uploaded_files',
  'carts',
  'cart_items',
  'cart_item_customizations',
  'orders',
  'order_items',
  'order_item_customizations',
  'payment_attempts',
  'refunds',
  // Phase 8 — merchant PaymentAccount foundation. Has FKs to `tenants`/
  // `stores` (both listed below) so TRUNCATE...CASCADE would empty it
  // transitively either way — listed explicitly anyway, matching this
  // file's own "belt and suspenders" completeness philosophy.
  'payment_accounts',
  'order_status_history',
  'webhook_events',
  'idempotency_keys',
  'outbox_events',
  'app_settings',
  // Phase 5 (W9) — additive AppSetting tenant/store ownership. `tenant_
  // counters` is included here too: W9 is its first real read/write
  // consumer (invoice numbering), so it now matters for test isolation
  // the same way app_settings already did.
  'tenant_settings',
  'store_settings',
  'tenant_counters',
  // SaaS Foundation (Phase 1) — additive. No existing e2e test writes to
  // these yet; listed so the truncate stays complete as later phases do.
  'subscriptions',
  // Phase 7 — D7 SaaS Billing Webhooks wave. Deliberately has NO foreign
  // key to `subscriptions` or any other table (see schema.prisma's own
  // comment on `BillingWebhookEvent`), so — unlike `subscription_events`,
  // which TRUNCATE...CASCADE already empties via its FK to `subscriptions`
  // even though it isn't listed here — this table MUST be listed
  // explicitly, or rows accumulate across tests within the same file.
  'billing_webhook_events',
  'store_domains',
  'stores',
  'tenant_memberships',
  'tenants',
  'plans',
  // SaaS Identity (Phase 2a) — additive (Customer). No customer auth runtime
  // yet; only the tenancy-foundation / platform-guard specs write here.
  'customers',
  // Phase 5 (W2) — additive audit foundation. Written by
  // platform-control-plane.e2e-spec.ts (W3) onward.
  'platform_audit_logs',
  'tenant_audit_logs',
];

/**
 * Phase 7 — Wave B shared-fixture fix. The baseline tenant's `Subscription`
 * (below) is `ACTIVE`, but pre-Phase-7 it never carried a confirmed billing
 * period at all — now that `CheckoutService` fails closed
 * (`ServiceUnavailableException('billing_period_unavailable')`) on any
 * `ACTIVE` subscription with no `currentPeriodStart`, that omission would
 * break `POST /checkout/orders` for every e2e suite that reaches this
 * tenant, not just Phase 7 ones. Fixed dates, not `new Date()`/`Date.now()`
 * — the same "hand-picked ISO date pair" convention already used
 * throughout the Phase 7 e2e suites (e.g. `subscription-orchestration
 * .service.spec.ts`'s own `new Date('2026-01-01T00:00:00Z')` fixtures) —
 * so every test run is reproducible regardless of when it executes, and
 * this period's "age" relative to the real clock is irrelevant: nothing in
 * `CheckoutService`'s enforcement checks whether `now` falls inside
 * `[currentPeriodStart, currentPeriodEnd)`, only that a confirmed period
 * exists at all. A 30-day span (`currentPeriodEnd = currentPeriodStart +
 * 30 days`) mirrors `FakeBillingProvider`'s own `FAKE_PERIOD_MS` — a
 * complete period, not merely a start with no end.
 */
export const BASELINE_SUBSCRIPTION_PERIOD_START = new Date(
  '2026-01-01T00:00:00.000Z',
);
export const BASELINE_SUBSCRIPTION_PERIOD_END = new Date(
  '2026-01-31T00:00:00.000Z',
);

/**
 * Full-truncate isolation between tests (§29/§27 — this repo has no other
 * established e2e reset pattern; app.e2e-spec.ts's /health test never
 * touches the database). RESTART IDENTITY CASCADE resets every table in
 * one statement regardless of FK direction — safe because every table here
 * uses a uuid default, not a serial, so nothing actually depends on the
 * identity reset; it's just cheap insurance.
 *
 * Guarded to only ever run against a database whose name ends in `_test`,
 * so a misconfigured DATABASE_URL can never truncate printforge_dev's real
 * data — see test/e2e/support/README.md.
 */
export async function resetDatabase(
  prisma: PrismaClient,
  options: { seedBaselineTenant?: boolean } = {},
): Promise<void> {
  const url = process.env.DATABASE_URL ?? '';
  const dbName = url.split('/').pop()?.split('?')[0] ?? '';
  if (!dbName.endsWith('_test')) {
    throw new Error(
      `Refusing to truncate database "${dbName}" — DATABASE_URL must point at a *_test database for e2e tests. Check .env.test is being loaded (test/e2e/support/env.setup.ts).`,
    );
  }
  const tableList = ALL_TABLES.map((t) => `"${t}"`).join(', ');
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`,
  );

  // Phase 4 W7 (decision P4-D2's create-path fix) — real deployed
  // environments always have at least one `Tenant` row (Phase 1's
  // bootstrap seed runs before the app ever serves traffic); a freshly
  // truncated test database does not, unless a test explicitly creates
  // one (`registerAdmin`, `makeTenantAndStore`, ...). Many existing e2e
  // tests exercise flows (uploads, cart, checkout) that predate Phase 4
  // and were never written to set up a tenant, because none was needed.
  // Seeding one baseline tenant here by default — same as real
  // production always having one — means `StorefrontTenantResolver`'s
  // fallback always has a real tenant to resolve to for those tests,
  // without changing any of them. A test that creates its OWN tenant(s)
  // (e.g. for cross-tenant isolation assertions) is unaffected: that
  // tenant simply becomes the most-recently-created one from that point
  // on. Pass `{ seedBaselineTenant: false }` for the rare test that
  // asserts an exact tenant count/row set starting from a truly empty
  // table (e.g. `tenant-bootstrap-seed.e2e-spec.ts`'s own seed-script
  // smoke test).
  if (options.seedBaselineTenant ?? true) {
    const tenant = await prisma.tenant.create({
      data: { slug: 'test-baseline-tenant' },
    });
    // Phase 5 W9 (decision D11) — real tenants always have a primary Store
    // from creation (`prisma/seed-tenant-bootstrap.ts` creates Tenant +
    // Store together), and `resolvePrimaryStoreId` now sits on paths that
    // are otherwise unconditional (e.g. checkout's shipping-fee lookup).
    // Without this, any test that never explicitly creates its own tenant
    // (relying on this baseline one via `StorefrontTenantResolver`'s
    // fallback) would 404 the moment it touched a STORE-owned setting.
    // Mirrors `fixtures.ts`'s own `grantOwnerMembership`/`ensureTenantId`
    // pairing for every OTHER tenant a test fixture creates.
    await prisma.store.create({
      data: {
        tenantId: tenant.id,
        slug: 'baseline-store',
        name: 'Test Store',
        status: 'ACTIVE',
        isPrimary: true,
      },
    });
    // Phase 6 W5 (P6-D4) — `storage_mb` is now enforced at the real
    // `/uploads` boundary (deny-by-default, P6-D2, when no PlanLimit
    // exists). Several pre-existing e2e suites upload a file via the
    // storefront/customer path (no explicit tenant of their own — see the
    // comment above), which resolves to THIS baseline tenant, and were
    // never written to configure any entitlement — none needed one before
    // W5. `limitValue: null` (unlimited) rather than any specific number:
    // this is test infrastructure unblocking unrelated pre-existing tests
    // from an entitlement gate they don't exist to exercise, not a
    // commercial/business value (no product-supplied number is invented
    // here — see docs/saas/DECISIONS.md P6-D2/P6-D3 on why `null` is a
    // structural, not arbitrary, value). Mirrors the Store-pairing
    // precedent immediately above: a cross-cutting new requirement is
    // satisfied once here rather than patched into every affected test
    // file individually.
    const baselinePlan = await prisma.plan.create({
      data: {
        key: `baseline-plan-${randomUUID()}`,
        name: 'Baseline Test Plan',
        isActive: true,
        sortOrder: 0,
        isEnterpriseCustom: false,
      },
    });
    await prisma.planLimit.create({
      data: {
        planId: baselinePlan.id,
        limitKey: 'storage_mb',
        limitValue: null,
        period: 'PERSISTENT',
      },
    });
    // Phase 7 — Wave B shared-fixture fix. Same reasoning as `storage_mb`
    // immediately above, now that `orders_per_month` is actually enforced
    // (Wave B) against a tenant with a confirmed billing period (which the
    // baseline subscription now has, per this file's own comment above) —
    // without this row, `EntitlementService`'s existing deny-by-default
    // behavior for a MISSING `PlanLimit` (P6-D2: `value: 0`) would reject
    // every checkout through the baseline tenant outright. `limitValue:
    // null` (unlimited, still tracked per P6-D3) for the same reason
    // `storage_mb` uses it: unblocking pre-existing tests from a limit
    // they were never written to exercise, not a commercial value.
    await prisma.planLimit.create({
      data: {
        planId: baselinePlan.id,
        limitKey: 'orders_per_month',
        limitValue: null,
        period: 'BILLING_PERIOD',
      },
    });
    await prisma.subscription.create({
      data: {
        tenantId: tenant.id,
        planId: baselinePlan.id,
        status: 'ACTIVE',
        currentPeriodStart: BASELINE_SUBSCRIPTION_PERIOD_START,
        currentPeriodEnd: BASELINE_SUBSCRIPTION_PERIOD_END,
      },
    });
  }
}

/**
 * Postgres enum columns this helper is ever asked to insert into,
 * verbatim from schema.prisma's own enum blocks — an unspecified-type
 * query parameter needs an explicit cast to satisfy Postgres's own enum
 * type-resolution in an INSERT ... VALUES (…) parameter list. Extend this
 * map, not the function below, if a new legacy-fixture call needs another
 * enum column.
 */
const ENUM_COLUMNS: Record<string, string> = {
  'coupons.type': 'CouponType',
  'coupons.scopeType': 'CouponScopeType',
  'order_status_history.toStatus': 'OrderStatus',
  'order_status_history.fromStatus': 'OrderStatus',
  'payment_attempts.status': 'PaymentAttemptStatus',
  'outbox_events.eventType': 'OutboxEventType',
  'outbox_events.status': 'OutboxEventStatus',
  'refunds.status': 'RefundStatus',
  'reviews.status': 'ReviewStatus',
};

function isPlainObjectValue(value: unknown): boolean {
  return (
    value !== null && typeof value === 'object' && !(value instanceof Date)
  );
}

/**
 * Phase 4 W7 test redesign (P4-D2's create-path fix made this necessary) —
 * raw-SQL row insertion, bypassing Prisma Client's own typed `.create()`
 * entirely.
 *
 * WHY THIS EXISTS: a handful of W3/W4 backfill-tooling e2e tests
 * deliberately construct commerce rows exactly as they existed BEFORE any
 * Phase 4 backfill ran — no `tenantId`/`storeId`/`customerId` at all —
 * specifically to prove the backfill script (`prisma/backfill/
 * w4-backfill.ts`) correctly derives and sets ownership on such a row.
 * That is the whole point of those tests, not an oversight to "fix" by
 * adding tenantId to the fixture. As of Phase 4 W7 (decision P4-D2),
 * `tenantId` is `String` (not `String?`) on these tables in
 * `schema.prisma`, so Prisma Client's generated types — and its runtime
 * request validation — now refuse to build a `.create()` call that omits
 * it, on ANY database, regardless of what that database's actual columns
 * allow. Only the TYPE LAYER changed; the underlying `printforge_test`
 * DATABASE COLUMN is untouched by W7 — this repository's W7 migration has
 * only ever been applied to a disposable scratch database (see the W7
 * implementation/audit reports), never to `printforge_test` — so a raw
 * SQL `INSERT` that bypasses Prisma Client's own validation still
 * succeeds exactly as it did before Phase 4 touched these tables.
 *
 * This does NOT touch, weaken, or bypass any production code path —
 * `TenantContextGuard`, the tenant-scoped Prisma client, RLS, or any
 * application service's own server-derived `tenantId` (Phase 4 W7 /
 * P4-D2's actual fix) are completely unrelated to this helper, which
 * exists ONLY so a test can construct a fixture row Prisma Client's types
 * no longer permit constructing directly.
 *
 * `id` and `updatedAt` — present as NOT NULL / no-DB-default on every
 * table this is used against — are auto-supplied unless the caller
 * overrides them. Every other required column must be supplied
 * explicitly, exactly mirroring what the original `.create()` call this
 * replaces already specified. A plain-object value (not a `Date`) is
 * JSON-serialized and cast `::jsonb`; a column named in `ENUM_COLUMNS` is
 * cast to its Postgres enum type — both needed because an unspecified-
 * type raw parameter otherwise defaults to `text`, which Postgres will
 * not implicitly coerce to `jsonb`/an enum in this context.
 */
export async function rawInsert(
  prisma: PrismaClient,
  table: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown> & { id: string }> {
  // Not every table has both columns (e.g. `coupon_usages` has no
  // `updatedAt` at all) — check what actually exists rather than
  // hand-maintaining a per-table list that could silently drift.
  const existingCols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
    table,
  );
  const colSet = new Set(existingCols.map((c) => c.column_name));

  const row: Record<string, unknown> = { ...data };
  if (colSet.has('id') && !('id' in row)) {
    row.id = randomUUID();
  }
  if (colSet.has('updatedAt') && !('updatedAt' in row)) {
    row.updatedAt = new Date();
  }
  const keys = Object.keys(row);
  const columnSql = keys.map((k) => `"${k}"`).join(', ');
  const placeholderSql = keys
    .map((k, i) => {
      const enumType = ENUM_COLUMNS[`${table}.${k}`];
      if (enumType) {
        return `$${i + 1}::"${enumType}"`;
      }
      return isPlainObjectValue(row[k]) ? `$${i + 1}::jsonb` : `$${i + 1}`;
    })
    .join(', ');
  const values = keys.map((k) =>
    isPlainObjectValue(row[k]) ? JSON.stringify(row[k]) : row[k],
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO "${table}" (${columnSql}) VALUES (${placeholderSql})`,
    ...values,
  );

  return row as Record<string, unknown> & { id: string };
}

/**
 * Phase 4 W7 test redesign — reads a row back as a plain, untyped object,
 * bypassing Prisma Client's typed model accessors (`prisma.category.
 * findUnique`, etc.) for the READ side of the same problem `rawInsert`
 * solves for writes: Prisma Client validates a query's RESPONSE against
 * its generated model type too, not just requests — `findUniqueOrThrow`
 * on a row whose actual `tenantId` column is `NULL` throws
 * `PrismaClientKnownRequestError: Error converting field "tenantId" of
 * expected non-nullable type "String", found incompatible value of
 * "null"`, even though the row was never written through Prisma Client
 * at all. Any test asserting a legacy-fixture row's ownership column
 * (`tenantId`/`customerId`/etc.) reads it back through this instead.
 */
export async function rawSelectById(
  prisma: PrismaClient,
  table: string,
  id: string,
): Promise<Record<string, unknown>> {
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT * FROM "${table}" WHERE id = $1`,
    id,
  );
  if (rows.length !== 1) {
    throw new Error(
      `rawSelectById: expected exactly 1 row in "${table}" for id=${id}, got ${rows.length}`,
    );
  }
  return rows[0];
}

/**
 * Phase 4 W7 test redesign — updates a row via raw SQL, for the same
 * reason `rawInsert`/`rawSelectById` exist: `prisma.<model>.update(...)`
 * returns (and therefore validates) the post-update row, which throws
 * the same non-nullable-field error if a legacy fixture's `tenantId` is
 * still `NULL` and this particular update doesn't happen to set it. Only
 * needed when the update does NOT itself assign the ownership column to
 * a real value — an update that does (e.g. `data: { tenantId: '...' }`)
 * returns a non-null value and is unaffected, so stays a normal typed
 * `prisma.<model>.update(...)` call.
 */
export async function rawUpdate(
  prisma: PrismaClient,
  table: string,
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  const keys = Object.keys(data);
  const setSql = keys
    .map((k, i) => {
      const enumType = ENUM_COLUMNS[`${table}.${k}`];
      const placeholder = enumType ? `$${i + 2}::"${enumType}"` : `$${i + 2}`;
      return `"${k}" = ${isPlainObjectValue(data[k]) ? `${placeholder}::jsonb` : placeholder}`;
    })
    .join(', ');
  const values = keys.map((k) =>
    isPlainObjectValue(data[k]) ? JSON.stringify(data[k]) : data[k],
  );
  await prisma.$executeRawUnsafe(
    `UPDATE "${table}" SET ${setSql} WHERE id = $1`,
    id,
    ...values,
  );
}
