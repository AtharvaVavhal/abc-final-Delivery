import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { rawInsert, rawSelectById, resetDatabase } from './support/db';

/**
 * SaaS Master Plan Phase 4, wave W3 (docs/saas/PHASE-4-IMPLEMENTATION-REPORT.md;
 * decisions D10, D11, P4-D1 — docs/saas/DECISIONS.md).
 *
 * Pure schema-constraint tests — a bare PrismaClient against the isolated
 * printforge_test database, mirroring the style of
 * identity-foundation.e2e-spec.ts. W3 added the ownership columns; W7
 * (P4-D2) later SET tenantId NOT NULL on the 20 commerce tables (outbox
 * stays nullable). This suite now asserts the post-W7 schema, not the
 * historical nullable-W3 snapshot.
 *
 * The expected tenantId/storeId/customerId requirement per table is PARSED
 * DIRECTLY from docs/saas/PHASE-4-IMPLEMENTATION-REPORT.md §4 at test-run
 * time (parseSpecOwnershipTable below) rather than hand-copied into a
 * literal here. The original start-gate spec file is no longer in the
 * tree; the implementation report's §4 table is the surviving source.
 */
describe('SaaS Phase 4 (W3) — tenant/store/customer scoping columns', () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ── Spec-derived TID/SID/CID requirement, parsed from the approved spec ──

  const SPEC_PATH = join(
    __dirname,
    '../../../docs/saas/PHASE-4-IMPLEMENTATION-REPORT.md',
  );

  /**
   * §3.1 (Category/Product/ProductImage/ProductVariant/CustomizationField)
   * uses a narrower table shape with NO CID column at all (none of those
   * five tables ever takes a customerId) — every other §3.2-§3.5 row has
   * TID | SID | CID. Structural knowledge of the document's own table
   * layout, not a copy of its per-row *values*.
   */
  const NO_CID_COLUMN_TABLES = new Set([
    'Category',
    'Product',
    'ProductImage',
    'ProductVariant',
    'CustomizationField',
  ]);

  /**
   * `UploadedFile`'s own §3.2 CID cell reads literally "conditional" (no
   * leading "✓", unlike every other conditional-CID row, e.g.
   * `OrderStatusHistory`'s "✓ conditional (\`changedByCustomerId?\`)") — a
   * one-off formatting inconsistency in the spec text itself, not a "not
   * required" signal: the same row's own "Target FKs" cell explicitly says
   * `add \`uploadedByCustomerId?→Customer\` (customer path)`, and P4-D1
   * names `UploadedFile.uploadedByCustomerId?` in its approved column list.
   * Documented override, not a silent broadening of the CID matcher.
   */
  const CID_REQUIRED_OVERRIDE = new Set(['UploadedFile']);

  interface SpecOwnership {
    tid: boolean;
    sid: boolean;
    cid: boolean;
  }

  /** Parses every `| \`Model\` (\`table\`) | \`tenantId\`, ... |` row in report §4. */
  function parseSpecOwnershipTable(): Map<string, SpecOwnership> {
    const spec = readFileSync(SPEC_PATH, 'utf8');
    const result = new Map<string, SpecOwnership>();
    const rowRe = /^\|\s*`(\w+)`\s*\(`\w+`\)\s*\|\s*([^|]+)\|/gm;
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(spec)) !== null) {
      const [, modelName, colCell] = m;
      result.set(modelName, {
        tid: /`tenantId`/.test(colCell),
        sid: /`storeId`/.test(colCell),
        cid: NO_CID_COLUMN_TABLES.has(modelName)
          ? false
          : /customerId/i.test(colCell) || CID_REQUIRED_OVERRIDE.has(modelName),
      });
    }
    return result;
  }

  /** table (Prisma model name) -> DB table name, for every W3-scoped table. */
  const MODEL_TO_TABLE: Record<string, string> = {
    Category: 'categories',
    Product: 'products',
    ProductImage: 'product_images',
    ProductVariant: 'product_variants',
    CustomizationField: 'customization_fields',
    UploadedFile: 'uploaded_files',
    Cart: 'carts',
    CartItem: 'cart_items',
    CartItemCustomization: 'cart_item_customizations',
    Order: 'orders',
    Invoice: 'invoices',
    OrderItem: 'order_items',
    OrderItemCustomization: 'order_item_customizations',
    PaymentAttempt: 'payment_attempts',
    Refund: 'refunds',
    OrderStatusHistory: 'order_status_history',
    IdempotencyKey: 'idempotency_keys',
    Coupon: 'coupons',
    CouponUsage: 'coupon_usages',
    Review: 'reviews',
  };

  /**
   * The customerId-FAMILY column *name* on each table the spec marks CID for
   * (§3's CID column only says whether one is required, not what it's
   * called) — sourced verbatim from decision P4-D1's approved column list
   * (docs/saas/DECISIONS.md): "Cart.customerId?, Order.customerId?,
   * Review.customerId?, CouponUsage.customerId?, IdempotencyKey.customerId?,
   * UploadedFile.uploadedByCustomerId?, OrderStatusHistory.changedByCustomerId?
   * /changedByMembershipId?". `OutboxEvent` is handled separately below (§3.6
   * shape, tenantId-only, nullable forever — no CID at all).
   */
  const CUSTOMER_ID_COLUMNS: Record<string, string[]> = {
    Cart: ['customerId'],
    Order: ['customerId'],
    Review: ['customerId'],
    CouponUsage: ['customerId'],
    IdempotencyKey: ['customerId'],
    UploadedFile: ['uploadedByCustomerId'],
    OrderStatusHistory: ['changedByCustomerId', 'changedByMembershipId'],
  };

  const specOwnership = parseSpecOwnershipTable();

  it('sanity: the spec parser found a row for every W3-scoped table (catches a spec-format change silently breaking this suite)', () => {
    for (const model of Object.keys(MODEL_TO_TABLE)) {
      expect(specOwnership.has(model)).toBe(true);
    }
    // OutboxEvent lives in §3.6's differently-shaped table but still parses.
    expect(specOwnership.has('OutboxEvent')).toBe(true);
  });

  it('sanity: the spec requires tenantId (TID) on every one of these tables', () => {
    for (const model of Object.keys(MODEL_TO_TABLE)) {
      expect(specOwnership.get(model)?.tid).toBe(true);
    }
    expect(specOwnership.get('OutboxEvent')?.tid).toBe(true);
  });

  it("the CUSTOMER_ID_COLUMNS map (from decision P4-D1) agrees with the spec's own CID marker in both directions", () => {
    for (const model of Object.keys(MODEL_TO_TABLE)) {
      const specSaysRequired = specOwnership.get(model)?.cid ?? false;
      const mapHasColumns = model in CUSTOMER_ID_COLUMNS;
      expect(mapHasColumns).toBe(specSaysRequired);
    }
  });

  /** Builds the full expected column list for a table, purely from the spec + P4-D1. */
  function expectedColumnsFor(model: string): string[] {
    const ownership = specOwnership.get(model);
    if (!ownership) throw new Error(`no spec row parsed for ${model}`);
    const cols: string[] = [];
    if (ownership.tid) cols.push('tenantId');
    if (ownership.sid) cols.push('storeId');
    if (ownership.cid) cols.push(...(CUSTOMER_ID_COLUMNS[model] ?? []));
    return cols;
  }

  describe('every spec-required column exists, has no default, and matches post-W7 nullability', () => {
    const cases = Object.keys(MODEL_TO_TABLE).flatMap((model) =>
      expectedColumnsFor(model).map(
        (col) => [MODEL_TO_TABLE[model], col] as const,
      ),
    );

    it('there is at least one case to check (guards against an empty/broken parse silently no-op-ing this suite)', () => {
      expect(cases.length).toBeGreaterThan(20);
    });

    it.each(cases)('%s.%s', async (table, column) => {
      const rows = await prisma.$queryRawUnsafe<
        { is_nullable: string; column_default: string | null }[]
      >(
        `SELECT is_nullable, column_default FROM information_schema.columns
          WHERE table_name = $1 AND column_name = $2`,
        table,
        column,
      );
      expect(rows).toHaveLength(1);
      // W7 SET NOT NULL on tenantId for these 20 tables; storeId and the
      // customerId-family columns stay nullable.
      expect(rows[0].is_nullable).toBe(column === 'tenantId' ? 'NO' : 'YES');
      expect(rows[0].column_default).toBeNull();
    });
  });

  it('OutboxEvent.tenantId exists, is nullable, has no default (§3.6 — nullable forever, never SET NOT NULL even in W7)', async () => {
    const rows = await prisma.$queryRawUnsafe<
      { is_nullable: string; column_default: string | null }[]
    >(
      `SELECT is_nullable, column_default FROM information_schema.columns
        WHERE table_name = 'outbox_events' AND column_name = 'tenantId'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].is_nullable).toBe('YES');
    expect(rows[0].column_default).toBeNull();
  });

  it('W7 rejects a commerce insert that omits tenantId; storeId may still be null', async () => {
    await resetDatabase(prisma);
    await expect(
      rawInsert(prisma, 'categories', {
        name: 'Test',
        slug: `cat-${randomUUID()}`,
      }),
    ).rejects.toThrow(/23502|Failing row|null value/);
    const tenant = await prisma.tenant.create({
      data: { slug: `t-${randomUUID()}` },
    });
    const { id } = await rawInsert(prisma, 'categories', {
      name: 'Test',
      slug: `cat-${randomUUID()}`,
      tenantId: tenant.id,
    });
    const category = await rawSelectById(prisma, 'categories', id);
    expect(category.tenantId).toBe(tenant.id);
    expect(category.storeId).toBeNull();
  });

  it('CouponUsage.storeId (the P1 fix) reads back NULL on an untouched row and accepts a real value', async () => {
    await resetDatabase(prisma);
    const tenant = await prisma.tenant.create({
      data: { slug: `t-${randomUUID()}` },
    });
    const store = await prisma.store.create({
      data: {
        tenantId: tenant.id,
        slug: `s-${randomUUID()}`,
        name: 'Test Store',
      },
    });
    const user = await prisma.user.create({
      data: { email: `u-${randomUUID()}@example.test`, passwordHash: 'x' },
    });
    // Legacy-shaped rows (no tenantId) — see rawInsert's doc comment in
    // support/db.ts for why raw SQL is required here as of W7.
    const coupon = await rawInsert(prisma, 'coupons', {
      code: `CODE-${randomUUID()}`,
      type: 'FLAT_AMOUNT',
      flatAmountOff: 10,
      scopeType: 'STORE_WIDE',
      createdByAdminId: user.id,
      tenantId: tenant.id,
      storeId: store.id,
    });
    const order = await rawInsert(prisma, 'orders', {
      orderNumber: `ORD-${randomUUID()}`,
      userId: user.id,
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
      tenantId: tenant.id,
    });
    const usageNoStore = await rawInsert(prisma, 'coupon_usages', {
      couponId: coupon.id,
      userId: user.id,
      orderId: order.id,
      discountAppliedAmount: 10,
      tenantId: tenant.id,
    });
    const readBackNoStore = await rawSelectById(
      prisma,
      'coupon_usages',
      usageNoStore.id,
    );
    expect(readBackNoStore.storeId).toBeNull();

    // storeId accepts a real value too (still a plain scalar — no FK yet).
    const order2 = await rawInsert(prisma, 'orders', {
      orderNumber: `ORD-${randomUUID()}`,
      userId: user.id,
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
      tenantId: tenant.id,
    });
    const usageWithStore = await rawInsert(prisma, 'coupon_usages', {
      couponId: coupon.id,
      userId: user.id,
      orderId: order2.id,
      discountAppliedAmount: 10,
      tenantId: tenant.id,
      storeId: store.id,
    });
    const readBackWithStore = await rawSelectById(
      prisma,
      'coupon_usages',
      usageWithStore.id,
    );
    expect(readBackWithStore.storeId).toBe(store.id);
  });

  describe('TenantCounter (decision D10 — sequential per-tenant numbering)', () => {
    beforeEach(async () => {
      await resetDatabase(prisma);
    });

    async function makeTenant(): Promise<string> {
      const t = await prisma.tenant.create({
        data: { slug: `t-${randomUUID()}` },
      });
      return t.id;
    }

    it('creates with value defaulting to 0 and a real FK to Tenant', async () => {
      const tenantId = await makeTenant();
      const counter = await prisma.tenantCounter.create({
        data: { tenantId, key: 'order_number' },
      });
      expect(counter.value).toBe(0);
    });

    it('@@unique([tenantId, key]) rejects a duplicate key for the same tenant', async () => {
      const tenantId = await makeTenant();
      await prisma.tenantCounter.create({
        data: { tenantId, key: 'order_number' },
      });
      await expect(
        prisma.tenantCounter.create({
          data: { tenantId, key: 'order_number' },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('the same key is independent per tenant (tenant-scoped, not global)', async () => {
      const t1 = await makeTenant();
      const t2 = await makeTenant();
      await prisma.tenantCounter.create({
        data: { tenantId: t1, key: 'order_number' },
      });
      const c2 = await prisma.tenantCounter.create({
        data: { tenantId: t2, key: 'order_number' },
      });
      expect(c2.value).toBe(0);
    });

    it('an atomic UPDATE ... RETURNING-style increment (no check-then-increment) advances the counter', async () => {
      const tenantId = await makeTenant();
      await prisma.tenantCounter.create({
        data: { tenantId, key: 'order_number' },
      });
      const updated = await prisma.tenantCounter.update({
        where: { tenantId_key: { tenantId, key: 'order_number' } },
        data: { value: { increment: 1 } },
      });
      expect(updated.value).toBe(1);
    });

    it('tenantId FK rejects a non-existent tenant', async () => {
      await expect(
        prisma.tenantCounter.create({
          data: { tenantId: randomUUID(), key: 'order_number' },
        }),
      ).rejects.toMatchObject({ code: 'P2003' });
    });

    it('is RESTRICT — a Tenant with a counter cannot be hard-deleted', async () => {
      const tenantId = await makeTenant();
      await prisma.tenantCounter.create({
        data: { tenantId, key: 'order_number' },
      });
      await expect(
        prisma.tenant.delete({ where: { id: tenantId } }),
      ).rejects.toMatchObject({ code: 'P2003' });
    });
  });
});
