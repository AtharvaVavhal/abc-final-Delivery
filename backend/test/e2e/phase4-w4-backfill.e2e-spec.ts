import { randomUUID } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  rawInsert,
  rawSelectById,
  rawUpdate,
  resetDatabase,
} from './support/db';
import {
  validateTarget,
  runAllSteps,
  validateCounterAgainstMax,
  prisma as backfillPrisma,
} from '../../prisma/backfill/w4-backfill';
import {
  captureSnapshot,
  compareSnapshots,
  postOnlyChecks,
} from '../../prisma/backfill/reconcile';

/**
 * Phase 4, W4/W5 backfill tooling — e2e coverage against the isolated
 * printforge_test database. Complements (does not replace) the real
 * end-to-end demonstration against a realistic local scratch copy
 * (docs/saas/PHASE-4-IMPLEMENTATION-REPORT.md §12 — 875 real rows across
 * 21 tables, dry-run + real-run + idempotent-rerun + full reconciliation).
 * This suite exercises the same exported functions the CLI tools
 * (prisma/backfill/w4-backfill.ts, reconcile.ts) use, under Jest's control,
 * so the logic has automated regression coverage rather than relying on a
 * one-off manual run.
 *
 * Phase 4 W7 (decision P4-D2) test redesign — READ THIS BEFORE EDITING A
 * FIXTURE HELPER BELOW. This suite's entire point is to construct rows
 * exactly as they existed BEFORE any Phase 4 backfill ran (no
 * tenantId/storeId/customerId at all), then prove `runAllSteps` correctly
 * derives and sets ownership on them. As of W7, `tenantId` is `String`
 * (not `String?`) on these tables in `schema.prisma`, so Prisma Client's
 * generated types — and its runtime request/response validation — refuse
 * to build or deserialize a row that omits it, on ANY database. Every
 * fixture helper below that used to call `prisma.<model>.create({...})`
 * without a `tenantId` now calls `rawInsert` instead (raw SQL, bypasses
 * Prisma Client's own validation only — the underlying `printforge_test`
 * DATABASE COLUMN is unaffected: this repo's W7 migration has only ever
 * run against a disposable scratch database, never here). Any read of
 * such a row THAT MAY STILL HAVE A NULL OWNERSHIP COLUMN AT READ TIME
 * (i.e. before `runAllSteps` has backfilled it, or inside a rolled-back
 * transaction) uses `rawSelectById` for the same reason on the read side
 * — Prisma Client throws `PrismaClientKnownRequestError: Error converting
 * field "tenantId" of expected non-nullable type "String", found
 * incompatible value of "null"` even on a pure read, if the actual column
 * value is null. A read that happens AFTER a successful (non-rolled-back)
 * `runAllSteps` call needs no change — by then the real column value is
 * always non-null, exactly what the test is proving. `prisma/backfill/
 * {w4-backfill,reconcile}.ts` themselves are untouched — verified they
 * already do all of this via raw SQL internally, never a typed model
 * read on any of these tables.
 */
describe('Phase 4 W4/W5 — backfill tooling', () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
    await backfillPrisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  // ── Fixture builders ──────────────────────────────────────────────────

  async function makeTenantAndStore(): Promise<{
    tenantId: string;
    storeId: string;
  }> {
    const tenant = await prisma.tenant.create({
      data: { slug: `t-${randomUUID()}` },
    });
    const store = await prisma.store.create({
      data: {
        tenantId: tenant.id,
        slug: `s-${randomUUID()}`,
        name: 'Test Store',
        status: 'ACTIVE',
        isPrimary: true,
      },
    });
    return { tenantId: tenant.id, storeId: store.id };
  }

  async function makeAdminUser(): Promise<string> {
    const u = await prisma.user.create({
      data: {
        email: `admin-${randomUUID()}@example.test`,
        passwordHash: 'x',
        role: 'ADMIN',
      },
    });
    return u.id;
  }

  /** A CUSTOMER-role User with a matching Customer row under the given store (mirrors Phase 2b). */
  async function makeCustomerWithMatch(
    storeId: string,
    tenantId: string,
  ): Promise<{ userId: string; customerId: string; email: string }> {
    const email = `cust-${randomUUID()}@example.test`;
    const u = await prisma.user.create({
      data: { email, passwordHash: 'x', role: 'CUSTOMER' },
    });
    const c = await prisma.customer.create({
      data: { storeId, tenantId, email, passwordHash: 'x' },
    });
    return { userId: u.id, customerId: c.id, email };
  }

  /** A CUSTOMER-role User with NO matching Customer row (the "missing match" anomaly case). */
  async function makeCustomerWithoutMatch(): Promise<string> {
    const u = await prisma.user.create({
      data: {
        email: `orphan-${randomUUID()}@example.test`,
        passwordHash: 'x',
        role: 'CUSTOMER',
      },
    });
    return u.id;
  }

  async function latestTenantId(): Promise<string> {
    const existing = await prisma.tenant.findFirst({
      orderBy: { createdAt: 'desc' },
    });
    if (!existing) {
      throw new Error('expected a tenant (call makeTenantAndStore first)');
    }
    return existing.id;
  }

  async function makeCategoryAndProduct(): Promise<{
    categoryId: string;
    productId: string;
  }> {
    const tenantId = await latestTenantId();
    const category = await rawInsert(prisma, 'categories', {
      name: 'Cat',
      slug: `cat-${randomUUID()}`,
      tenantId,
    });
    const product = await rawInsert(prisma, 'products', {
      categoryId: category.id,
      name: 'Prod',
      slug: `prod-${randomUUID()}`,
      basePrice: 100,
      minQuantity: 1,
      tenantId,
    });
    return { categoryId: category.id, productId: product.id };
  }

  async function makeOrder(
    userId: string,
    extra: Partial<Prisma.OrderUncheckedCreateInput> = {},
  ): Promise<string> {
    const tenantId =
      typeof extra.tenantId === 'string'
        ? extra.tenantId
        : await latestTenantId();
    const order = await rawInsert(prisma, 'orders', {
      orderNumber: `ORD-${randomUUID()}`,
      userId,
      subtotal: 100,
      shippingFee: 0,
      total: 100,
      shippingRecipientName: 'Test',
      shippingPhone: '0000000000',
      shippingAddressLine1: 'Line 1',
      shippingCity: 'City',
      shippingState: 'State',
      shippingPostalCode: '000000',
      shippingCountry: 'IN',
      tenantId,
      ...extra,
    });
    return order.id;
  }

  // ── validateTarget ──────────────────────────────────────────────────────

  describe('validateTarget', () => {
    it('accepts a real tenant + its real primary store', async () => {
      const { tenantId, storeId } = await makeTenantAndStore();
      await expect(validateTarget(tenantId, storeId)).resolves.toBeUndefined();
    });

    it('rejects a non-existent tenant', async () => {
      const { storeId } = await makeTenantAndStore();
      await expect(validateTarget(randomUUID(), storeId)).rejects.toThrow(
        /does not exist/,
      );
    });

    it('rejects a non-existent store', async () => {
      const { tenantId } = await makeTenantAndStore();
      await expect(validateTarget(tenantId, randomUUID())).rejects.toThrow(
        /does not exist/,
      );
    });

    it('rejects a store belonging to a DIFFERENT tenant', async () => {
      const a = await makeTenantAndStore();
      const b = await makeTenantAndStore();
      await expect(validateTarget(a.tenantId, b.storeId)).rejects.toThrow(
        /belongs to tenant/,
      );
    });

    it('rejects a non-primary store', async () => {
      const { tenantId } = await makeTenantAndStore();
      const secondary = await prisma.store.create({
        data: {
          tenantId,
          slug: `s2-${randomUUID()}`,
          name: 'Secondary',
          status: 'ACTIVE',
          isPrimary: false,
        },
      });
      await expect(validateTarget(tenantId, secondary.id)).rejects.toThrow(
        /not the primary store/,
      );
    });
  });

  // ── Core backfill behavior ──────────────────────────────────────────────

  describe('runAllSteps — ownership completeness, customerId derivation, idempotency', () => {
    it('backfills a full representative dataset correctly on the first run, and is a no-op on the second (idempotent rerun)', async () => {
      const { tenantId, storeId } = await makeTenantAndStore();
      const admin = await makeAdminUser();
      const cust = await makeCustomerWithMatch(storeId, tenantId);
      const { categoryId, productId } = await makeCategoryAndProduct();

      await rawInsert(prisma, 'product_images', {
        productId,
        cloudinaryPublicId: `pub-${randomUUID()}`,
        tenantId,
      });

      const coupon = await rawInsert(prisma, 'coupons', {
        code: `CODE-${randomUUID()}`,
        type: 'FLAT_AMOUNT',
        flatAmountOff: 10,
        scopeType: 'STORE_WIDE',
        createdByAdminId: admin,
        tenantId,
      });

      const cart = await rawInsert(prisma, 'carts', {
        userId: cust.userId,
        tenantId,
      });
      await rawInsert(prisma, 'cart_items', {
        cartId: cart.id,
        productId,
        quantity: 1,
        tenantId,
      });

      // Order by a role=CUSTOMER user with a Customer match. Uses the REAL
      // orderNumber format (PF-###### — orders.service.ts::generateOrderNumber)
      // rather than a random UUID, since this test also exercises the
      // TenantCounter safety gate (validateCounterAgainstMax), which parses
      // the trailing digit run of every orderNumber/invoiceNumber to compute
      // the actual MAX — a UUID-based orderNumber would be malformed/
      // non-deterministic under that check.
      const orderId = await makeOrder(cust.userId, {
        orderNumber: 'PF-000001',
      });
      const orderItem = await rawInsert(prisma, 'order_items', {
        orderId,
        productId,
        productNameSnapshot: 'Prod',
        unitPriceSnapshot: 100,
        quantity: 1,
        lineTotal: 100,
        tenantId,
      });
      await rawInsert(prisma, 'invoices', {
        invoiceNumber: 'INV-000001',
        orderId,
        currency: 'INR',
        subtotal: 100,
        discountAmount: 0,
        shippingFee: 0,
        taxableAmount: 100,
        taxAmount: 0,
        grandTotal: 100,
        taxMode: 'INCLUSIVE',
        sellerSnapshot: {},
        tenantId,
      });
      const paymentAttempt = await rawInsert(prisma, 'payment_attempts', {
        orderId,
        razorpayOrderId: `rzp_${randomUUID()}`,
        amountPaise: 10000n,
        status: 'CAPTURED',
        tenantId,
      });
      await rawInsert(prisma, 'refunds', {
        paymentAttemptId: paymentAttempt.id,
        amountPaise: 1000n,
        tenantId,
      });
      await rawInsert(prisma, 'order_status_history', {
        orderId,
        toStatus: 'PAID',
        changedByUserId: cust.userId,
        tenantId,
      });
      await rawInsert(prisma, 'coupon_usages', {
        couponId: coupon.id,
        userId: cust.userId,
        orderId,
        discountAppliedAmount: 10,
        tenantId,
      });

      // Order by an ADMIN-role user (admin-who-also-shopped anomaly class — expected, not an error).
      // Real, sequential PF-###### number — same reasoning as the cust
      // order above (the TenantCounter safety gate parses every order's
      // number, including this one).
      const adminOrderId = await makeOrder(admin, { orderNumber: 'PF-000002' });
      void adminOrderId;

      await rawInsert(prisma, 'idempotency_keys', {
        key: `key-${randomUUID()}`,
        userId: cust.userId,
        endpoint: '/checkout',
        resultOrderId: orderId,
        expiresAt: new Date(Date.now() + 3600_000),
        tenantId,
      });
      // An IdempotencyKey with no resultOrderId (the "direct assign" path).
      await rawInsert(prisma, 'idempotency_keys', {
        key: `key-${randomUUID()}`,
        userId: cust.userId,
        endpoint: '/checkout',
        expiresAt: new Date(Date.now() + 3600_000),
        tenantId,
      });

      await rawInsert(prisma, 'reviews', {
        productId,
        userId: cust.userId,
        orderItemId: orderItem.id,
        rating: 5,
        tenantId,
      });

      const uploadedFile = await rawInsert(prisma, 'uploaded_files', {
        cloudinaryPublicId: `up-${randomUUID()}`,
        uploadedByUserId: cust.userId,
        format: 'png',
        bytes: 10,
        resourceType: 'image',
        deliveryType: 'upload',
        tenantId,
      });
      void uploadedFile;
      // The orphan-customer (role=CUSTOMER, no Customer match) anomaly path is
      // covered by the dedicated "anomaly handling" describe block below —
      // deliberately NOT mixed into this fixture, which asserts everything
      // reconciles cleanly.
      // An uploaded file by an ADMIN (no customerId expected — not an anomaly).
      await rawInsert(prisma, 'uploaded_files', {
        cloudinaryPublicId: `up-${randomUUID()}`,
        uploadedByUserId: admin,
        format: 'png',
        bytes: 10,
        resourceType: 'image',
        deliveryType: 'upload',
        tenantId,
      });

      await prisma.outboxEvent.create({
        data: {
          eventType: 'ORDER_PAID',
          aggregateType: 'Order',
          aggregateId: orderId,
          eventKey: `ek-${randomUUID()}`,
          payload: {},
        },
      });
      // A non-Order aggregateType — must stay NULL forever (spec §3.6).
      await prisma.outboxEvent.create({
        data: {
          eventType: 'PASSWORD_RESET_REQUESTED',
          aggregateType: 'User',
          aggregateId: cust.userId,
          eventKey: `ek-${randomUUID()}`,
          payload: {},
        },
      });

      // Counter values match the real orders/invoice created above exactly
      // (two orders -> MAX=2; one invoice -> MAX=1) — required by the
      // TenantCounter safety gate (validateCounterAgainstMax), which now
      // refuses to seed unless the source counter equals the actual MAX
      // issued number.
      await prisma.appSetting.create({
        data: { key: 'order_number_counter', value: '2' },
      });
      await prisma.appSetting.create({
        data: { key: 'invoice_number_counter', value: '1' },
      });

      void categoryId;

      // ── First run: real writes ──
      const run1 = await runAllSteps(prisma, tenantId, storeId);
      const totalAffected1 = run1.reduce((s, r) => s + r.affected, 0);
      expect(totalAffected1).toBeGreaterThan(0);

      // Ownership completeness — every affected table's tenantId is set.
      const checks1 = await postOnlyChecks(tenantId, storeId);
      const failing1 = checks1.filter((c) => !c.pass);
      expect(failing1).toEqual([]);

      // No anomalies expected in this clean fixture (orphan-customer case is
      // covered separately below).
      const uploadedCustomerIdStep = run1.find(
        (r) => r.step === 'uploaded_files.uploadedByCustomerId',
      );
      expect(uploadedCustomerIdStep?.anomalies).toBeUndefined();

      // TenantCounter seeded from app_settings values.
      const counters = await prisma.tenantCounter.findMany({
        where: { tenantId },
      });
      expect(
        counters
          .map((c) => ({ key: c.key, value: c.value }))
          .sort((a, b) => a.key.localeCompare(b.key)),
      ).toEqual([
        { key: 'invoice_number_counter', value: 1 },
        { key: 'order_number_counter', value: 2 },
      ]);

      // outbox_events: Order-type got tenantId, User-type stayed NULL.
      const outboxRows = await prisma.outboxEvent.findMany({
        orderBy: { aggregateType: 'asc' },
      });
      const orderEvent = outboxRows.find((e) => e.aggregateType === 'Order');
      const userEvent = outboxRows.find((e) => e.aggregateType === 'User');
      expect(orderEvent?.tenantId).toBe(tenantId);
      expect(userEvent?.tenantId).toBeNull();

      // ── Second run: idempotent no-op ──
      const run2 = await runAllSteps(prisma, tenantId, storeId);
      const totalAffected2 = run2.reduce((s, r) => s + r.affected, 0);
      expect(totalAffected2).toBe(0);
      for (const r of run2) {
        expect(r.affected).toBe(0);
      }
    });
  });

  // ── TenantCounter safety validation (P2 fix — W4 independent audit) ────

  describe('TenantCounter safety validation (validateCounterAgainstMax)', () => {
    async function makeSequentialOrders(
      userId: string,
      count: number,
    ): Promise<void> {
      for (let i = 1; i <= count; i++) {
        await makeOrder(userId, {
          orderNumber: `PF-${String(i).padStart(6, '0')}`,
        });
      }
    }

    it('counter equals actual MAX -> PASS', async () => {
      const { tenantId, storeId } = await makeTenantAndStore();
      const cust = await makeCustomerWithMatch(storeId, tenantId);
      await makeSequentialOrders(cust.userId, 3);
      await prisma.appSetting.create({
        data: { key: 'order_number_counter', value: '3' },
      });

      const v = await validateCounterAgainstMax(
        prisma,
        'order_number_counter',
        'orders',
        'orderNumber',
      );
      expect(v).toMatchObject({ status: 'PASS', sourceValue: 3, actualMax: 3 });
    });

    it('counter BELOW actual MAX -> a real collision risk, fails', async () => {
      const { tenantId, storeId } = await makeTenantAndStore();
      const cust = await makeCustomerWithMatch(storeId, tenantId);
      await makeSequentialOrders(cust.userId, 3);
      // Source counter says only 2 have ever been issued, but 3 real rows exist.
      await prisma.appSetting.create({
        data: { key: 'order_number_counter', value: '2' },
      });

      const v = await validateCounterAgainstMax(
        prisma,
        'order_number_counter',
        'orders',
        'orderNumber',
      );
      expect(v).toMatchObject({
        status: 'BELOW_MAX',
        sourceValue: 2,
        actualMax: 3,
      });
    });

    it('counter ABOVE actual MAX -> explicit drift detected (small case)', async () => {
      const { tenantId, storeId } = await makeTenantAndStore();
      const cust = await makeCustomerWithMatch(storeId, tenantId);
      await makeSequentialOrders(cust.userId, 5);
      await prisma.appSetting.create({
        data: { key: 'order_number_counter', value: '6' },
      });

      const v = await validateCounterAgainstMax(
        prisma,
        'order_number_counter',
        'orders',
        'orderNumber',
      );
      expect(v).toMatchObject({
        status: 'ABOVE_MAX',
        sourceValue: 6,
        actualMax: 5,
      });
    });

    it('reproduces the EXACT printforge_dev-discovered scenario: 51 sequential orders (PF-000001..PF-000051, zero gaps), counter=52 -> ABOVE_MAX, drift of exactly 1', async () => {
      const { tenantId, storeId } = await makeTenantAndStore();
      const cust = await makeCustomerWithMatch(storeId, tenantId);
      await makeSequentialOrders(cust.userId, 51);
      await prisma.appSetting.create({
        data: { key: 'order_number_counter', value: '52' },
      });

      const v = await validateCounterAgainstMax(
        prisma,
        'order_number_counter',
        'orders',
        'orderNumber',
      );
      expect(v.status).toBe('ABOVE_MAX');
      expect(v.sourceValue).toBe(52);
      expect(v.actualMax).toBe(51);
      expect(v.sourceValue! - v.actualMax!).toBe(1);
    });

    it('a malformed existing orderNumber (no trailing digit run) -> fails safely, never guesses', async () => {
      const { tenantId, storeId } = await makeTenantAndStore();
      const cust = await makeCustomerWithMatch(storeId, tenantId);
      await makeOrder(cust.userId, { orderNumber: 'PF-NOT-A-NUMBER' });
      await prisma.appSetting.create({
        data: { key: 'order_number_counter', value: '1' },
      });

      const v = await validateCounterAgainstMax(
        prisma,
        'order_number_counter',
        'orders',
        'orderNumber',
      );
      expect(v.status).toBe('MALFORMED');
      expect(v.malformedCount).toBe(1);
    });

    it('a malformed source app_settings value -> fails safely', async () => {
      const { tenantId } = await makeTenantAndStore();
      await prisma.appSetting.create({
        data: { key: 'order_number_counter', value: 'not-a-number' },
      });

      const v = await validateCounterAgainstMax(
        prisma,
        'order_number_counter',
        'orders',
        'orderNumber',
      );
      expect(v.status).toBe('SOURCE_MALFORMED');
      void tenantId;
    });

    it('no app_settings row for the key -> NO_SOURCE_ROW (not an error, nothing to seed)', async () => {
      const v = await validateCounterAgainstMax(
        prisma,
        'order_number_counter',
        'orders',
        'orderNumber',
      );
      expect(v.status).toBe('NO_SOURCE_ROW');
    });

    describe('integration: seedTenantCounters (via runAllSteps) actually refuses to seed on anything but PASS', () => {
      it('BELOW_MAX: no TenantCounter row is created; the anomaly is reported', async () => {
        const { tenantId, storeId } = await makeTenantAndStore();
        const cust = await makeCustomerWithMatch(storeId, tenantId);
        await makeSequentialOrders(cust.userId, 3);
        await prisma.appSetting.create({
          data: { key: 'order_number_counter', value: '2' },
        });

        const results = await runAllSteps(prisma, tenantId, storeId);
        const step = results.find(
          (r) => r.step === 'tenant_counters (order_number_counter)',
        );
        expect(step?.affected).toBe(0);
        expect(step?.anomalies).toEqual({ counter_below_max: 1 });
        expect(step?.detail).toMatch(/source is BEHIND/);

        const counters = await prisma.tenantCounter.findMany({
          where: { tenantId, key: 'order_number_counter' },
        });
        expect(counters).toEqual([]);
      });

      it('ABOVE_MAX (the printforge_dev scenario): no TenantCounter row is created; drift is reported with exact numbers', async () => {
        const { tenantId, storeId } = await makeTenantAndStore();
        const cust = await makeCustomerWithMatch(storeId, tenantId);
        await makeSequentialOrders(cust.userId, 51);
        await prisma.appSetting.create({
          data: { key: 'order_number_counter', value: '52' },
        });

        const results = await runAllSteps(prisma, tenantId, storeId);
        const step = results.find(
          (r) => r.step === 'tenant_counters (order_number_counter)',
        );
        expect(step?.affected).toBe(0);
        expect(step?.anomalies).toEqual({ counter_above_max: 1 });
        expect(step?.detail).toContain('= 52');
        expect(step?.detail).toContain('actual MAX');
        expect(step?.detail).toContain('51');
        expect(step?.detail).toMatch(/ahead of/);

        const counters = await prisma.tenantCounter.findMany({
          where: { tenantId, key: 'order_number_counter' },
        });
        expect(counters).toEqual([]);

        // app_settings itself is never touched — surfaced, not silently repaired.
        const setting = await prisma.appSetting.findUniqueOrThrow({
          where: { key: 'order_number_counter' },
        });
        expect(setting.value).toBe('52');
      });

      it('PASS: the TenantCounter row IS created with exactly the source value', async () => {
        const { tenantId, storeId } = await makeTenantAndStore();
        const cust = await makeCustomerWithMatch(storeId, tenantId);
        await makeSequentialOrders(cust.userId, 4);
        await prisma.appSetting.create({
          data: { key: 'order_number_counter', value: '4' },
        });

        const results = await runAllSteps(prisma, tenantId, storeId);
        const step = results.find(
          (r) => r.step === 'tenant_counters (order_number_counter)',
        );
        expect(step?.affected).toBe(1);
        expect(step?.anomalies).toBeUndefined();

        const counter = await prisma.tenantCounter.findUniqueOrThrow({
          where: { tenantId_key: { tenantId, key: 'order_number_counter' } },
        });
        expect(counter.value).toBe(4);
      });
    });

    describe('reconcile.ts postOnlyChecks — independent post-hoc drift detection', () => {
      it('flags an already-seeded TenantCounter that has drifted from the current actual MAX', async () => {
        const { tenantId, storeId } = await makeTenantAndStore();
        const cust = await makeCustomerWithMatch(storeId, tenantId);
        await makeSequentialOrders(cust.userId, 2);
        // Seed a TenantCounter directly (bypassing the gate) to simulate a
        // row that was correct when seeded but has since drifted — e.g. if
        // rows were added to `orders` through some path after seeding.
        await prisma.tenantCounter.create({
          data: { tenantId, key: 'order_number_counter', value: 5 },
        });

        const checks = await postOnlyChecks(tenantId, storeId);
        const driftCheck = checks.find(
          (c) =>
            c.check ===
            'TenantCounter matches actual MAX (no drift): order_number_counter',
        );
        expect(driftCheck?.pass).toBe(false);
        expect(driftCheck?.detail).toContain('tenant_counters.value=5');
        expect(driftCheck?.detail).toContain('actual MAX');
      });

      it('passes when the seeded TenantCounter matches the actual MAX', async () => {
        const { tenantId, storeId } = await makeTenantAndStore();
        const cust = await makeCustomerWithMatch(storeId, tenantId);
        await makeSequentialOrders(cust.userId, 2);
        await prisma.tenantCounter.create({
          data: { tenantId, key: 'order_number_counter', value: 2 },
        });

        const checks = await postOnlyChecks(tenantId, storeId);
        const driftCheck = checks.find(
          (c) =>
            c.check ===
            'TenantCounter matches actual MAX (no drift): order_number_counter',
        );
        expect(driftCheck?.pass).toBe(true);
      });
    });
  });

  // ── userId / order-number / invoice-number / financial preservation ────

  describe('preservation guarantees (reconciliation)', () => {
    it('userId, order numbers, invoice numbers, and financial sums are byte-for-byte unchanged after a real backfill run', async () => {
      const { tenantId, storeId } = await makeTenantAndStore();
      const cust = await makeCustomerWithMatch(storeId, tenantId);
      const orderId = await makeOrder(cust.userId, {
        orderNumber: 'PF-000042',
        total: 555.5,
      });
      await rawInsert(prisma, 'invoices', {
        invoiceNumber: 'INV-000042',
        orderId,
        currency: 'INR',
        subtotal: 555.5,
        discountAmount: 0,
        shippingFee: 0,
        taxableAmount: 555.5,
        taxAmount: 0,
        grandTotal: 555.5,
        taxMode: 'INCLUSIVE',
        sellerSnapshot: {},
        tenantId,
      });
      const paymentAttempt = await rawInsert(prisma, 'payment_attempts', {
        orderId,
        razorpayOrderId: `rzp_${randomUUID()}`,
        amountPaise: 55550n,
        status: 'CAPTURED',
        tenantId,
      });
      void paymentAttempt;

      const before = await captureSnapshot();
      await runAllSteps(prisma, tenantId, storeId);
      const after = await captureSnapshot();

      const checks = compareSnapshots(before, after);
      const failing = checks.filter((c) => !c.pass);
      expect(failing).toEqual([]);

      const order = await prisma.order.findUniqueOrThrow({
        where: { id: orderId },
      });
      expect(order.userId).toBe(cust.userId);
      expect(order.orderNumber).toBe('PF-000042');
      expect(Number(order.total)).toBe(555.5);

      const invoice = await prisma.invoice.findFirstOrThrow({
        where: { orderId },
      });
      expect(invoice.invoiceNumber).toBe('INV-000042');
    });

    it('compareSnapshots correctly FAILS when a financial value is tampered with between snapshots (proves the check is real, not a rubber stamp)', async () => {
      const { tenantId, storeId } = await makeTenantAndStore();
      const cust = await makeCustomerWithMatch(storeId, tenantId);
      const orderId = await makeOrder(cust.userId, { total: 100 });

      const before = await captureSnapshot();
      // Simulate an unexpected mutation the backfill should never itself
      // perform. Raw update (see support/db.ts's own comment) — this
      // order's tenantId is still null (no backfill runs in this test)
      // and this update doesn't set it, so a typed `prisma.order.update`
      // would throw on deserializing its own response.
      await rawUpdate(prisma, 'orders', orderId, { total: 999 });
      const after = await captureSnapshot();

      const checks = compareSnapshots(before, after);
      const totalCheck = checks.find(
        (c) => c.check === 'order total sum unchanged',
      );
      expect(totalCheck?.pass).toBe(false);
    });
  });

  // ── Anomaly handling — not silently "fixed" ─────────────────────────────

  describe('anomaly handling', () => {
    it('reports (never silently resolves) a role=CUSTOMER user with no matching Customer row', async () => {
      const { tenantId, storeId } = await makeTenantAndStore();
      const orphan = await makeCustomerWithoutMatch();
      await makeOrder(orphan);

      const results = await runAllSteps(prisma, tenantId, storeId);
      const step = results.find((r) => r.step === 'orders.customerId');
      expect(step?.affected).toBe(0);
      expect(step?.anomalies).toEqual({
        customer_role_user_with_no_matching_customer_row: 1,
      });

      const orders = await prisma.order.findMany();
      expect(orders[0].customerId).toBeNull();
      // tenantId/storeId are still backfilled — only customerId is affected by this anomaly.
      expect(orders[0].tenantId).toBe(tenantId);
    });

    it('an ADMIN-role user with order history gets tenantId/storeId but NO customerId (expected — not an anomaly)', async () => {
      const { tenantId, storeId } = await makeTenantAndStore();
      const admin = await makeAdminUser();
      await makeOrder(admin);

      const results = await runAllSteps(prisma, tenantId, storeId);
      const customerStep = results.find((r) => r.step === 'orders.customerId');
      expect(customerStep?.affected).toBe(0);
      expect(customerStep?.anomalies).toBeUndefined();

      const order = await prisma.order.findFirstOrThrow();
      expect(order.tenantId).toBe(tenantId);
      expect(order.storeId).toBe(storeId);
      expect(order.customerId).toBeNull();
      expect(order.userId).toBe(admin);
    });

    it('does not overwrite an already-set tenantId (safe no-op, never "corrects" an existing value)', async () => {
      const a = await makeTenantAndStore();
      const b = await makeTenantAndStore();
      const cust = await makeCustomerWithMatch(a.storeId, a.tenantId);
      const orderId = await makeOrder(cust.userId);
      // Pre-set to tenant A, then attempt to backfill against tenant B.
      await prisma.order.update({
        where: { id: orderId },
        data: { tenantId: a.tenantId, storeId: a.storeId },
      });

      const results = await runAllSteps(prisma, b.tenantId, b.storeId);
      const step = results.find((r) => r.step === 'orders');
      expect(step?.affected).toBe(0);

      const order = await prisma.order.findUniqueOrThrow({
        where: { id: orderId },
      });
      expect(order.tenantId).toBe(a.tenantId); // unchanged — never overwritten
    });
  });

  // ── Dry-run / rollback behavior ─────────────────────────────────────────

  describe('dry-run (rollback-only transaction) behavior', () => {
    it('a rolled-back transaction leaves the database completely unchanged, even though real UPDATE statements ran inside it', async () => {
      const { tenantId, storeId } = await makeTenantAndStore();
      const cust = await makeCustomerWithMatch(storeId, tenantId);
      const orderId = await makeOrder(cust.userId);

      const ROLLBACK_SENTINEL = 'TEST_ROLLBACK_SENTINEL';
      let capturedResults: Awaited<ReturnType<typeof runAllSteps>> = [];
      await expect(
        prisma.$transaction(async (tx) => {
          capturedResults = await runAllSteps(tx, tenantId, storeId);
          throw new Error(ROLLBACK_SENTINEL);
        }),
      ).rejects.toThrow(ROLLBACK_SENTINEL);

      // The transaction saw real affected-row counts...
      const totalAffected = capturedResults.reduce((s, r) => s + r.affected, 0);
      expect(totalAffected).toBeGreaterThan(0);

      // ...but nothing persisted. tenantId was already set on insert
      // (W7 NOT NULL); storeId/customerId backfill rolled back.
      const order = await rawSelectById(prisma, 'orders', orderId);
      expect(order.tenantId).toBe(tenantId);
      expect(order.storeId).toBeNull();
      const counters = await prisma.tenantCounter.findMany({
        where: { tenantId },
      });
      expect(counters).toEqual([]);
    });
  });

  // ── Reconciliation orphan detection ─────────────────────────────────────

  describe('reconciliation — orphan detection', () => {
    it('postOnlyChecks flags a child row whose tenantId does not match its parent (a real orphan)', async () => {
      const { tenantId, storeId } = await makeTenantAndStore();
      const otherTenant = await prisma.tenant.create({
        data: { slug: `t2-${randomUUID()}` },
      });
      const { productId } = await makeCategoryAndProduct();
      await prisma.product.update({
        where: { id: productId },
        data: { tenantId, storeId },
      });
      // Deliberately mismatched: image points at a DIFFERENT tenant than its parent product.
      await prisma.productImage.create({
        data: {
          productId,
          cloudinaryPublicId: `pub-${randomUUID()}`,
          tenantId: otherTenant.id,
        },
      });

      const checks = await postOnlyChecks(tenantId, storeId);
      const orphanCheck = checks.find(
        (c) =>
          c.check ===
          'no orphaned ownership (tenantId matches parent): product_images -> products',
      );
      expect(orphanCheck?.pass).toBe(false);
    });
  });
});
