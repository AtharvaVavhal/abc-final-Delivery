import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { resetDatabase } from './support/db';
import { createTestApp } from './support/test-app';
import {
  addCartItem,
  apiPath,
  authHeader,
  createProduct,
  http,
  makeTenantCheckoutReady,
  registerAdmin,
  registerUser,
  shippingFields,
  TestUser,
} from './support/fixtures';
import {
  buildWebhookBody,
  signWebhookPayload,
} from './support/razorpay-signing';
import { PrismaService } from '../../src/common/database/prisma.service';
import { WebhookProcessor } from '../../src/payments/webhooks/webhook-processor.service';
import { EmailService } from '../../src/notifications/email/email.service';
import { backfillAppSettings } from '../../prisma/backfill/w9-app-setting-backfill';

/**
 * Phase 5 W9 (decision D11) — AppSetting tenant/store ownership.
 *
 * Complements the settings-specific assertions already embedded in
 * admin-control-plane.e2e-spec.ts (allowlist/validation/public surface),
 * tax-and-invoicing.e2e-spec.ts (tax config + invoice numbering within one
 * tenant), and tenant-audit-wiring.e2e-spec.ts (setting.update audit
 * metadata shape) — this suite is specifically about the OWNERSHIP
 * boundary itself: does a TENANT-owned or STORE-owned setting actually
 * stay isolated between two real, independent tenants; does the DB reject
 * a mismatched composite-ownership row; does invoice numbering run on an
 * independent per-tenant sequence; and does the W9 backfill script behave
 * correctly against a real database.
 */
describe('AppSetting tenant/store ownership (Phase 5 W9)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  // ─── A. Tenant isolation — TENANT-owned settings ───────────────────────

  describe('tenant isolation — TENANT-owned settings (tax.*)', () => {
    it("tenant A's tax rate never leaks into tenant B's admin settings listing", async () => {
      const adminA = await registerAdmin(app, prisma);
      const adminB = await registerAdmin(app, prisma);

      await http(app)
        .patch(apiPath('/admin/settings/tax.enabled'))
        .set(...authHeader(adminA))
        .send({ value: 'true' })
        .expect(200);
      await http(app)
        .patch(apiPath('/admin/settings/tax.ratePercent'))
        .set(...authHeader(adminA))
        .send({ value: '18.00' })
        .expect(200);

      const listB = await http(app)
        .get(apiPath('/admin/settings'))
        .set(...authHeader(adminB))
        .expect(200);
      const byKeyB = Object.fromEntries(
        (listB.body.data as Array<{ key: string; value: string }>).map((s) => [
          s.key,
          s.value,
        ]),
      );
      // B never configured tax — must see the untouched defaults, not A's
      // values, and not a 500/merge of the two.
      expect(byKeyB['tax.enabled']).toBe('false');
      expect(byKeyB['tax.ratePercent']).toBe('0.00');

      // Directly at the data layer too: exactly one tenantSetting row per
      // key, scoped to A, none scoped to B.
      const rowsA = await prisma.tenantSetting.findMany({
        where: { tenantId: adminA.tenantId, key: 'tax.ratePercent' },
      });
      const rowsB = await prisma.tenantSetting.findMany({
        where: { tenantId: adminB.tenantId, key: 'tax.ratePercent' },
      });
      expect(rowsA).toHaveLength(1);
      expect(rowsA[0].value).toBe('18.00');
      expect(rowsB).toHaveLength(0);
    });
  });

  // ─── B. Tenant/store isolation — STORE-owned settings ──────────────────

  describe('tenant isolation — STORE-owned settings (storeName, shippingFeeFlat)', () => {
    it("tenant A's store name and shipping fee never leak into tenant B's admin settings or storefront", async () => {
      const adminA = await registerAdmin(app, prisma);
      const adminB = await registerAdmin(app, prisma);

      await http(app)
        .patch(apiPath('/admin/settings/storeName'))
        .set(...authHeader(adminA))
        .send({ value: 'Store A' })
        .expect(200);
      await http(app)
        .patch(apiPath('/admin/settings/shippingFeeFlat'))
        .set(...authHeader(adminA))
        .send({ value: '75.00' })
        .expect(200);

      const listB = await http(app)
        .get(apiPath('/admin/settings'))
        .set(...authHeader(adminB))
        .expect(200);
      const byKeyB = Object.fromEntries(
        (listB.body.data as Array<{ key: string; value: string }>).map((s) => [
          s.key,
          s.value,
        ]),
      );
      expect(byKeyB.storeName).toBe('AB Creations'); // untouched default
      expect(byKeyB.shippingFeeFlat).toBe('0.00');

      const storeA = await prisma.store.findFirstOrThrow({
        where: { tenantId: adminA.tenantId, isPrimary: true },
      });
      const storeB = await prisma.store.findFirstOrThrow({
        where: { tenantId: adminB.tenantId, isPrimary: true },
      });
      const rowsOnB = await prisma.storeSetting.findMany({
        where: { storeId: storeB.id, key: 'storeName' },
      });
      expect(rowsOnB).toHaveLength(0);
      const rowsOnA = await prisma.storeSetting.findMany({
        where: { storeId: storeA.id, key: 'storeName' },
      });
      expect(rowsOnA).toHaveLength(1);
      expect(rowsOnA[0].value).toBe('Store A');
    });
  });

  // ─── C. Composite ownership integrity (DB-enforced) ────────────────────

  describe('composite ownership integrity', () => {
    it('the database rejects a store_settings row whose storeId belongs to a DIFFERENT tenantId (composite FK)', async () => {
      const adminA = await registerAdmin(app, prisma);
      const adminB = await registerAdmin(app, prisma);
      const storeB = await prisma.store.findFirstOrThrow({
        where: { tenantId: adminB.tenantId, isPrimary: true },
      });

      // Attempt to claim B's store under A's tenantId — must be rejected
      // by the DB-level composite FK
      // (store_settings_tenantId_storeId_fkey -> stores(tenantId, id)),
      // never merely by application-layer discipline.
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO "store_settings" (id, "tenantId", "storeId", key, value, "createdAt", "updatedAt")
           VALUES (gen_random_uuid()::text, $1, $2, 'storeName', 'hijacked', now(), now())`,
          adminA.tenantId,
          storeB.id,
        ),
      ).rejects.toThrow(/foreign key/i);
    });

    it('the database rejects a second store_settings row for the same (storeId, key) — no silent duplicate ownership', async () => {
      const admin = await registerAdmin(app, prisma);
      await http(app)
        .patch(apiPath('/admin/settings/storeName'))
        .set(...authHeader(admin))
        .send({ value: 'First' })
        .expect(200);
      const store = await prisma.store.findFirstOrThrow({
        where: { tenantId: admin.tenantId, isPrimary: true },
      });

      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO "store_settings" (id, "tenantId", "storeId", key, value, "createdAt", "updatedAt")
           VALUES (gen_random_uuid()::text, $1, $2, 'storeName', 'Duplicate', now(), now())`,
          admin.tenantId,
          store.id,
        ),
      ).rejects.toThrow(/already exists/i);
    });
  });

  // ─── D. Client-ownership-injection resistance ──────────────────────────

  describe('client-ownership-injection resistance', () => {
    it('a storeId/tenantId field in the PATCH body is rejected outright (whitelist validation), and never reaches the write path', async () => {
      const admin = await registerAdmin(app, prisma);
      const otherAdmin = await registerAdmin(app, prisma);
      const otherStore = await prisma.store.findFirstOrThrow({
        where: { tenantId: otherAdmin.tenantId, isPrimary: true },
      });

      // UpdateSettingDto only declares `value` — the global ValidationPipe
      // (whitelist + forbidNonWhitelisted, main.ts) rejects any extra field
      // outright with 400, before AppSettingService ever runs. Ownership
      // is never a request-supplied selector at all, contract-enforced.
      await http(app)
        .patch(apiPath('/admin/settings/storeName'))
        .set(...authHeader(admin))
        .send({
          value: 'Attempted Cross-Tenant Name',
          storeId: otherStore.id,
          tenantId: otherAdmin.tenantId,
        })
        .expect(400);

      // Nothing was written anywhere — not to the caller's own store, and
      // certainly not to the injected one.
      const otherRows = await prisma.storeSetting.findMany({
        where: { storeId: otherStore.id, key: 'storeName' },
      });
      expect(otherRows).toHaveLength(0);

      // The plain write (no extra fields) still succeeds normally and
      // lands on the caller's own store.
      await http(app)
        .patch(apiPath('/admin/settings/storeName'))
        .set(...authHeader(admin))
        .send({ value: 'Legit Name' })
        .expect(200);
      const own = await prisma.store.findFirstOrThrow({
        where: { tenantId: admin.tenantId, isPrimary: true },
      });
      const ownRow = await prisma.storeSetting.findFirstOrThrow({
        where: { storeId: own.id, key: 'storeName' },
      });
      expect(ownRow.value).toBe('Legit Name');
    });
  });

  // ─── E. Tenant lifecycle — TENANT-owned key ────────────────────────────

  describe('tenant lifecycle enforcement extends to TENANT-owned settings too', () => {
    it('a suspended tenant cannot write a TENANT-owned setting (tax.enabled) — blocked before any write', async () => {
      const admin = await registerAdmin(app, prisma);
      await prisma.tenant.update({
        where: { id: admin.tenantId },
        data: { status: 'SUSPENDED' },
      });

      await http(app)
        .patch(apiPath('/admin/settings/tax.enabled'))
        .set(...authHeader(admin))
        .send({ value: 'true' })
        .expect(403);

      expect(
        await prisma.tenantSetting.findUnique({
          where: {
            tenantId_key: { tenantId: admin.tenantId, key: 'tax.enabled' },
          },
        }),
      ).toBeNull();
    });
  });

  // ─── F. TenantCounter — invoice numbering is per-tenant, independent ───

  describe('invoice numbering runs on an independent sequence per tenant', () => {
    async function checkoutAndPay(
      user: TestUser,
      tenantId: string,
      processor: WebhookProcessor,
    ): Promise<string> {
      const { productId } = await createProduct(prisma, {
        basePrice: '100.00',
        tenantId,
      });
      await addCartItem(app, user, { productId, quantity: 1 });
      const res = await http(app)
        .post(apiPath('/checkout/orders'))
        .set(...authHeader(user))
        .set('Idempotency-Key', `w9-${randomUUID()}`)
        .send(shippingFields())
        .expect(201);
      const orderId = res.body.data.id as string;

      const order = await prisma.order.findUniqueOrThrow({
        where: { id: orderId },
      });
      const amountPaise = BigInt(
        order.total.times(100).toDecimalPlaces(0).toFixed(0),
      );
      const razorpayOrderId = `order_test_${randomUUID()}`;
      await prisma.order.update({
        where: { id: orderId },
        data: { razorpayOrderId },
      });
      await prisma.paymentAttempt.create({
        data: {
          orderId,
          razorpayOrderId,
          amountPaise,
          currency: 'INR',
          status: 'INITIATED',
          tenantId: order.tenantId,
        },
      });
      const body = buildWebhookBody('payment.captured', {
        id: `pay_${randomUUID()}`,
        order_id: razorpayOrderId,
        amount: Number(amountPaise),
        status: 'captured',
      });
      await http(app)
        .post(apiPath('/payments/webhook'))
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', signWebhookPayload(body))
        .set('x-razorpay-event-id', `evt_${randomUUID()}`)
        .send(body)
        .expect(200);
      await processor.processReceivedWebhooks();
      return orderId;
    }

    it("two different tenants each start their own invoice sequence at 1 — one tenant's volume never advances another's counter", async () => {
      const processor = app.get(WebhookProcessor);
      const emailSpy = jest
        .spyOn(app.get(EmailService), 'send')
        .mockResolvedValue(undefined);
      try {
        // Phase 5 W9 — this test's own ordering matters: `addCartItem`
        // creates a customer's Cart at most once (its `tenantId` is fixed
        // for good at that point, `StorefrontTenantResolver`'s own
        // "most recently created tenant" fallback, same as every other
        // ambient-tenant e2e test in this suite). Each user's FIRST
        // checkout below therefore happens right after ITS OWN admin is
        // registered — never after a later admin has already become the
        // "most recent" tenant — so each user's cart locks to the tenant
        // this test actually intends, and every later checkout for that
        // same user reuses the same already-tenant-scoped cart regardless
        // of what gets created afterward.
        const adminA = await registerAdmin(app, prisma);
        await makeTenantCheckoutReady(prisma, adminA.tenantId);
        const userA = await registerUser(app, 'invA');
        const aOrders = [
          await checkoutAndPay(userA, adminA.tenantId, processor),
        ];

        const adminB = await registerAdmin(app, prisma);
        await makeTenantCheckoutReady(prisma, adminB.tenantId);
        const userB = await registerUser(app, 'invB');
        const b1 = await checkoutAndPay(userB, adminB.tenantId, processor);

        // Two more paid orders for tenant A, after tenant B already exists
        // and already has its own order — proving A's cart stayed locked
        // to A throughout.
        aOrders.push(await checkoutAndPay(userA, adminA.tenantId, processor));
        aOrders.push(await checkoutAndPay(userA, adminA.tenantId, processor));

        const invNumbersA: string[] = [];
        for (const orderId of aOrders) {
          const res = await http(app)
            .get(apiPath(`/orders/${orderId}/invoice`))
            .set(...authHeader(userA))
            .expect(200);
          invNumbersA.push(res.body.data.invoiceNumber as string);
        }
        // Sequential and gap-free within tenant A.
        expect(invNumbersA).toEqual(['INV-000001', 'INV-000002', 'INV-000003']);

        const invB1 = (
          await http(app)
            .get(apiPath(`/orders/${b1}/invoice`))
            .set(...authHeader(userB))
            .expect(200)
        ).body.data.invoiceNumber as string;

        // B's first invoice is B's own #1 (INV-000001), NOT #4 — proving
        // the counter is tenant-scoped, not a shared/global sequence.
        expect(invB1).toBe('INV-000001');

        const counterA = await prisma.tenantCounter.findUnique({
          where: {
            tenantId_key: {
              tenantId: adminA.tenantId,
              key: 'invoice_number_counter',
            },
          },
        });
        const counterB = await prisma.tenantCounter.findUnique({
          where: {
            tenantId_key: {
              tenantId: adminB.tenantId,
              key: 'invoice_number_counter',
            },
          },
        });
        expect(counterA?.value).toBe(3);
        expect(counterB?.value).toBe(1);
      } finally {
        emailSpy.mockRestore();
      }
    });
  });

  // ─── G. Migration / backfill correctness (real database) ──────────────

  describe('w9-app-setting-backfill.ts against a real database', () => {
    it('classifies and migrates every frozen D11 key exactly once, preserves an unknown key, and is idempotent on rerun', async () => {
      const admin = await registerAdmin(app, prisma);
      const store = await prisma.store.findFirstOrThrow({
        where: { tenantId: admin.tenantId, isPrimary: true },
      });

      // Seed the LEGACY global table exactly as a pre-W9 deployment would
      // have it — including one key outside the frozen D11 classification.
      await prisma.appSetting.createMany({
        data: [
          { key: 'storeName', value: 'Legacy Store' },
          { key: 'tax.enabled', value: 'true' },
          { key: 'tax.ratePercent', value: '12.00' },
          { key: 'order_number_counter', value: '10' },
          { key: 'invoice_number_counter', value: '4' },
          { key: 'some_legacy_key_nobody_remembers', value: 'mystery' },
        ],
      });

      const first = await backfillAppSettings(prisma, admin.tenantId, store.id);
      expect(first.tenantMigrated).toBe(2); // tax.enabled, tax.ratePercent
      expect(first.storeMigrated).toBe(1); // storeName
      expect(first.unclassified).toEqual(['some_legacy_key_nobody_remembers']);

      const storeNameRow = await prisma.storeSetting.findUniqueOrThrow({
        where: { storeId_key: { storeId: store.id, key: 'storeName' } },
      });
      expect(storeNameRow.value).toBe('Legacy Store');
      const taxRow = await prisma.tenantSetting.findUniqueOrThrow({
        where: {
          tenantId_key: { tenantId: admin.tenantId, key: 'tax.ratePercent' },
        },
      });
      expect(taxRow.value).toBe('12.00');

      // Neither counter key was migrated — both stay exactly where they
      // were (order_number_counter platform-scoped/unrelated;
      // invoice_number_counter superseded by TenantCounter, untouched).
      expect(
        await prisma.tenantSetting.findUnique({
          where: {
            tenantId_key: {
              tenantId: admin.tenantId,
              key: 'invoice_number_counter',
            },
          },
        }),
      ).toBeNull();
      expect(
        await prisma.storeSetting.findUnique({
          where: {
            storeId_key: { storeId: store.id, key: 'order_number_counter' },
          },
        }),
      ).toBeNull();
      // The unknown key is still sitting in the legacy table, untouched.
      expect(
        await prisma.appSetting.findUnique({
          where: { key: 'some_legacy_key_nobody_remembers' },
        }),
      ).not.toBeNull();

      // Rerun: fully idempotent — nothing newly migrated, no duplicate
      // rows, no error.
      const second = await backfillAppSettings(
        prisma,
        admin.tenantId,
        store.id,
      );
      expect(second.tenantMigrated).toBe(0);
      expect(second.storeMigrated).toBe(0);
      expect(second.tenantSkippedExisting).toBe(2);
      expect(second.storeSkippedExisting).toBe(1);
      expect(
        await prisma.storeSetting.count({
          where: { storeId: store.id, key: 'storeName' },
        }),
      ).toBe(1);
    });

    it('refuses to run when the given store belongs to a different tenant than the given tenantId', async () => {
      const adminA = await registerAdmin(app, prisma);
      const adminB = await registerAdmin(app, prisma);
      const storeB = await prisma.store.findFirstOrThrow({
        where: { tenantId: adminB.tenantId, isPrimary: true },
      });

      await expect(
        backfillAppSettings(prisma, adminA.tenantId, storeB.id),
      ).rejects.toThrow(/refusing to guess/i);
    });
  });
});
