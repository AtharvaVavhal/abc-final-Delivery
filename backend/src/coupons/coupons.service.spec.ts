import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CouponScopeType, CouponType, Prisma } from '@prisma/client';
import { CouponsService, ValidateCouponParams } from './coupons.service';

/**
 * P8-4.1 — `createCoupon` now resolves the tenant's primary store via
 * `resolvePrimaryStoreId` (`common/tenant/primary-store.ts`), which itself
 * calls `getTenantScopedClient`. Mocked here exactly the same way
 * `payment-accounts.service.spec.ts` mocks it — a fake `{ store: {...} }`
 * client — rather than faking Prisma's `$extends` machinery for real.
 */
const mockStoreClient = { findFirst: jest.fn() };
jest.mock('../common/tenant/tenant-prisma', () => ({
  getTenantScopedClient: jest.fn(() => ({ store: mockStoreClient })),
}));

/**
 * Same direct-instantiation mocking pattern as orders.service.spec.ts.
 * `validateAndClaim`/`previewDiscount` are exercised through a fake `tx`
 * (structurally the same shape `Prisma.TransactionClient` and
 * `PrismaService` both satisfy) exposing only the handful of Prisma calls
 * these methods actually make — no real database. The atomic CAS itself
 * (`UPDATE ... WHERE usedCount < usageLimitTotal RETURNING id`) is
 * simulated via a controllable `$queryRaw` mock; its actual race-safety
 * is a property of the SQL running against real Postgres, verified live
 * against the dev database (see the phase report), not something a
 * mocked unit test can prove on its own — this suite instead proves
 * CouponsService's *control flow* around that CAS result is correct:
 * zero rows throws 409, non-zero rows proceeds.
 */
describe('CouponsService', () => {
  function buildCoupon(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'coupon-1',
      code: 'SAVE20',
      type: CouponType.PERCENTAGE,
      percentageOff: 20,
      flatAmountOff: null,
      scopeType: CouponScopeType.STORE_WIDE,
      categoryId: null,
      minOrderValue: null,
      usageLimitTotal: null,
      usageLimitPerUser: 1,
      usedCount: 0,
      firstOrderOnly: false,
      startsAt: null,
      expiresAt: null,
      isActive: true,
      description: null,
      createdByAdminId: 'admin-1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      ...overrides,
    };
  }

  function buildTx(
    coupon: ReturnType<typeof buildCoupon> | null,
    options: {
      orderCount?: number;
      usageCount?: number;
      claimReturnsRow?: boolean;
    } = {},
  ) {
    const { orderCount = 0, usageCount = 0, claimReturnsRow = true } = options;
    return {
      // `validateCouponCore` now calls `findFirst` (Phase 4 W7 — `code`
      // is no longer a bare-unique DB column, superseded by the composite
      // `(storeId, code)` unique added in W6).
      coupon: { findFirst: jest.fn().mockResolvedValue(coupon) },
      order: { count: jest.fn().mockResolvedValue(orderCount) },
      couponUsage: {
        count: jest.fn().mockResolvedValue(usageCount),
        create: jest.fn().mockResolvedValue({}),
      },
      $queryRaw: jest
        .fn()
        .mockResolvedValue(claimReturnsRow ? [{ id: coupon?.id }] : []),
    };
  }

  function buildParams(
    overrides: Partial<ValidateCouponParams> = {},
  ): ValidateCouponParams {
    return {
      code: 'save20',
      userId: 'user-1',
      subtotalPaise: 100_00n,
      shippingFeePaise: 49_00n,
      lineItems: [{ categoryId: 'cat-mugs', lineTotalPaise: 100_00n }],
      tenantId: 'tenant-1',
      ...overrides,
    };
  }

  describe('per-type discount calculation', () => {
    it('PERCENTAGE: discounts scopedSubtotalPaise by the configured percentage', async () => {
      const service = new CouponsService({} as never, {} as never);
      const coupon = buildCoupon({
        type: CouponType.PERCENTAGE,
        percentageOff: 20,
      });
      const tx = buildTx(coupon);

      const result = await service.validateAndClaim(
        tx as never,
        buildParams({ subtotalPaise: 100_00n }),
      );

      expect(result.discountPaise).toBe(20_00n); // 20% of ₹100.00
      expect(result.shippingFeePaise).toBe(49_00n); // unchanged
    });

    it('FLAT_AMOUNT: discounts by the flat amount when it fits under the subtotal', async () => {
      const service = new CouponsService({} as never, {} as never);
      const coupon = buildCoupon({
        type: CouponType.FLAT_AMOUNT,
        percentageOff: null,
        flatAmountOff: new Prisma.Decimal('30.00'),
      });
      const tx = buildTx(coupon);

      const result = await service.validateAndClaim(
        tx as never,
        buildParams({ subtotalPaise: 100_00n }),
      );

      expect(result.discountPaise).toBe(30_00n);
      expect(result.shippingFeePaise).toBe(49_00n);
    });

    it('FLAT_AMOUNT: caps the discount at scopedSubtotalPaise, never exceeding it (total can never go negative)', async () => {
      const service = new CouponsService({} as never, {} as never);
      const coupon = buildCoupon({
        type: CouponType.FLAT_AMOUNT,
        percentageOff: null,
        flatAmountOff: new Prisma.Decimal('500.00'), // way more than the subtotal
      });
      const tx = buildTx(coupon);

      const result = await service.validateAndClaim(
        tx as never,
        buildParams({ subtotalPaise: 100_00n }),
      );

      // Capped at the subtotal it's discounting, not the full ₹500.00.
      expect(result.discountPaise).toBe(100_00n);
    });

    it('FREE_SHIPPING: zero discount, but shippingFeePaise is overridden to 0', async () => {
      const service = new CouponsService({} as never, {} as never);
      const coupon = buildCoupon({
        type: CouponType.FREE_SHIPPING,
        percentageOff: null,
        flatAmountOff: null,
      });
      const tx = buildTx(coupon);

      const result = await service.validateAndClaim(
        tx as never,
        buildParams({ subtotalPaise: 100_00n, shippingFeePaise: 49_00n }),
      );

      expect(result.discountPaise).toBe(0n);
      expect(result.shippingFeePaise).toBe(0n);
    });
  });

  describe('category-scope isolation', () => {
    it('a CATEGORY-scoped coupon only discounts matching line items, not the whole cart', async () => {
      const service = new CouponsService({} as never, {} as never);
      const coupon = buildCoupon({
        type: CouponType.PERCENTAGE,
        percentageOff: 10,
        scopeType: CouponScopeType.CATEGORY,
        categoryId: 'cat-mugs',
      });
      const tx = buildTx(coupon);

      const result = await service.validateAndClaim(
        tx as never,
        buildParams({
          subtotalPaise: 300_00n, // full cart total
          lineItems: [
            { categoryId: 'cat-mugs', lineTotalPaise: 100_00n },
            { categoryId: 'cat-shirts', lineTotalPaise: 200_00n }, // not this coupon's category
          ],
        }),
      );

      // 10% of only the ₹100.00 mug line, not the full ₹300.00 cart.
      expect(result.discountPaise).toBe(10_00n);
    });

    it('rejects a CATEGORY-scoped coupon when nothing in the cart matches its category', async () => {
      const service = new CouponsService({} as never, {} as never);
      const coupon = buildCoupon({
        scopeType: CouponScopeType.CATEGORY,
        categoryId: 'cat-mugs',
      });
      const tx = buildTx(coupon);

      await expect(
        service.validateAndClaim(
          tx as never,
          buildParams({
            lineItems: [{ categoryId: 'cat-shirts', lineTotalPaise: 200_00n }],
          }),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(tx.$queryRaw).not.toHaveBeenCalled();
    });

    it('a STORE_WIDE coupon discounts the whole subtotal regardless of per-item categories', async () => {
      const service = new CouponsService({} as never, {} as never);
      const coupon = buildCoupon({
        type: CouponType.PERCENTAGE,
        percentageOff: 10,
        scopeType: CouponScopeType.STORE_WIDE,
      });
      const tx = buildTx(coupon);

      const result = await service.validateAndClaim(
        tx as never,
        buildParams({
          subtotalPaise: 300_00n,
          lineItems: [
            { categoryId: 'cat-mugs', lineTotalPaise: 100_00n },
            { categoryId: 'cat-shirts', lineTotalPaise: 200_00n },
          ],
        }),
      );

      expect(result.discountPaise).toBe(30_00n); // 10% of the full ₹300.00
    });
  });

  describe('usage-limit exhaustion (concurrent claims)', () => {
    it('throws 409 when the atomic CAS claim returns zero rows (lost the race to a concurrent claim)', async () => {
      const service = new CouponsService({} as never, {} as never);
      const coupon = buildCoupon({ usageLimitTotal: 10, usedCount: 9 });
      // Simulates: by the time this UPDATE runs, another transaction's
      // commit already pushed usedCount to 10 — the CAS's WHERE clause no
      // longer matches, so RETURNING gives back zero rows.
      const tx = buildTx(coupon, { claimReturnsRow: false });

      await expect(
        service.validateAndClaim(tx as never, buildParams()),
      ).rejects.toThrow(ConflictException);
    });

    it('succeeds when the CAS claim returns a row (usage limit not yet reached)', async () => {
      const service = new CouponsService({} as never, {} as never);
      const coupon = buildCoupon({ usageLimitTotal: 10, usedCount: 5 });
      const tx = buildTx(coupon, { claimReturnsRow: true });

      await expect(
        service.validateAndClaim(tx as never, buildParams()),
      ).resolves.toBeDefined();
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('a coupon with no usageLimitTotal (unlimited) is never blocked by the CAS', async () => {
      const service = new CouponsService({} as never, {} as never);
      const coupon = buildCoupon({ usageLimitTotal: null, usedCount: 100_000 });
      const tx = buildTx(coupon, { claimReturnsRow: true });

      await expect(
        service.validateAndClaim(tx as never, buildParams()),
      ).resolves.toBeDefined();
    });
  });

  describe('per-user usage limit', () => {
    it('rejects (400, not the CAS/409) when this user has already used the coupon usageLimitPerUser times', async () => {
      const service = new CouponsService({} as never, {} as never);
      const coupon = buildCoupon({ usageLimitPerUser: 1 });
      const tx = buildTx(coupon, { usageCount: 1 });

      await expect(
        service.validateAndClaim(tx as never, buildParams()),
      ).rejects.toThrow(BadRequestException);
      // Rejected before ever attempting the total-usage CAS.
      expect(tx.$queryRaw).not.toHaveBeenCalled();
    });

    it('allows a user under their per-user limit', async () => {
      const service = new CouponsService({} as never, {} as never);
      const coupon = buildCoupon({ usageLimitPerUser: 2 });
      const tx = buildTx(coupon, { usageCount: 1 });

      await expect(
        service.validateAndClaim(tx as never, buildParams()),
      ).resolves.toBeDefined();
    });

    it('a coupon with no usageLimitPerUser (null, unlimited per user) is never blocked here', async () => {
      const service = new CouponsService({} as never, {} as never);
      const coupon = buildCoupon({ usageLimitPerUser: null });
      const tx = buildTx(coupon, { usageCount: 50 });

      await expect(
        service.validateAndClaim(tx as never, buildParams()),
      ).resolves.toBeDefined();
    });
  });

  describe('firstOrderOnly', () => {
    it('rejects a user who already has at least one order, of any status', async () => {
      const service = new CouponsService({} as never, {} as never);
      const coupon = buildCoupon({ firstOrderOnly: true });
      const tx = buildTx(coupon, { orderCount: 1 });

      await expect(
        service.validateAndClaim(tx as never, buildParams()),
      ).rejects.toThrow(BadRequestException);
      expect(tx.$queryRaw).not.toHaveBeenCalled();
    });

    it('allows a user with zero prior orders', async () => {
      const service = new CouponsService({} as never, {} as never);
      const coupon = buildCoupon({ firstOrderOnly: true });
      const tx = buildTx(coupon, { orderCount: 0 });

      await expect(
        service.validateAndClaim(tx as never, buildParams()),
      ).resolves.toBeDefined();
    });

    it('ignores the unpaid order a coupon is being attached to when counting prior orders', async () => {
      const service = new CouponsService({} as never, {} as never);
      const coupon = buildCoupon({ firstOrderOnly: true });
      const tx = buildTx(coupon, { orderCount: 0 });

      await expect(
        service.validateAndClaim(
          tx as never,
          buildParams({ ignoreOrderId: 'order-unpaid-1' }),
        ),
      ).resolves.toBeDefined();
      expect(tx.order.count).toHaveBeenCalledWith({
        where: { userId: 'user-1', id: { not: 'order-unpaid-1' } },
      });
    });
  });

  describe('minOrderValue', () => {
    it('rejects when the scoped subtotal is below the coupon minimum', async () => {
      const service = new CouponsService({} as never, {} as never);
      const coupon = buildCoupon({
        minOrderValue: new Prisma.Decimal('200.00'),
      });
      const tx = buildTx(coupon);

      await expect(
        service.validateAndClaim(
          tx as never,
          buildParams({ subtotalPaise: 100_00n }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows when the scoped subtotal meets the minimum exactly', async () => {
      const service = new CouponsService({} as never, {} as never);
      const coupon = buildCoupon({
        minOrderValue: new Prisma.Decimal('100.00'),
      });
      const tx = buildTx(coupon);

      await expect(
        service.validateAndClaim(
          tx as never,
          buildParams({ subtotalPaise: 100_00n }),
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('inactive / expired / not-yet-started coupons', () => {
    it('rejects an inactive coupon', async () => {
      const service = new CouponsService({} as never, {} as never);
      const coupon = buildCoupon({ isActive: false });
      const tx = buildTx(coupon);

      await expect(
        service.validateAndClaim(tx as never, buildParams()),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an expired coupon', async () => {
      const service = new CouponsService({} as never, {} as never);
      const coupon = buildCoupon({
        expiresAt: new Date('2020-01-01T00:00:00.000Z'),
      });
      const tx = buildTx(coupon);

      await expect(
        service.validateAndClaim(tx as never, buildParams()),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a coupon that has not started yet', async () => {
      const service = new CouponsService({} as never, {} as never);
      const coupon = buildCoupon({
        startsAt: new Date('2099-01-01T00:00:00.000Z'),
      });
      const tx = buildTx(coupon);

      await expect(
        service.validateAndClaim(tx as never, buildParams()),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an unknown coupon code', async () => {
      const service = new CouponsService({} as never, {} as never);
      const tx = buildTx(null);

      await expect(
        service.validateAndClaim(tx as never, buildParams({ code: 'NOPE' })),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('previewDiscount (read-only, no claim)', () => {
    it('computes the same discount as validateAndClaim but never touches $queryRaw or increments usedCount', async () => {
      const coupon = buildCoupon({
        type: CouponType.PERCENTAGE,
        percentageOff: 20,
      });
      const tx = buildTx(coupon);
      // previewDiscount uses `this.prisma`, not a tx — inject the same
      // fake object as the constructor's PrismaService.
      const previewService = new CouponsService(tx as never, {} as never);

      const result = await previewService.previewDiscount(
        buildParams({ subtotalPaise: 100_00n }),
      );

      expect(result.discountPaise).toBe(20_00n);
      expect(result.couponCode).toBe('SAVE20');
      expect(tx.$queryRaw).not.toHaveBeenCalled();
      expect(tx.couponUsage.create).not.toHaveBeenCalled();
    });

    it('still enforces every validation rule (e.g. expired) the same as validateAndClaim', async () => {
      const coupon = buildCoupon({
        expiresAt: new Date('2020-01-01T00:00:00.000Z'),
      });
      const tx = buildTx(coupon);
      const previewService = new CouponsService(tx as never, {} as never);

      await expect(
        previewService.previewDiscount(buildParams()),
      ).rejects.toThrow(BadRequestException);
    });
  });
});

describe('CouponsService.createCoupon — audit atomicity (Phase 5 W8)', () => {
  beforeEach(() => {
    mockStoreClient.findFirst.mockReset();
    mockStoreClient.findFirst.mockResolvedValue({ id: 'store-a-primary' });
  });

  it('fails the whole operation when the audit write fails — the create call still happened, which is why it must be inside the same transaction', async () => {
    const couponDelegate = {
      create: jest.fn().mockResolvedValue({ id: 'coupon-1', code: 'SAVE10' }),
    };
    const tenantMembershipDelegate = {
      findUnique: jest.fn().mockResolvedValue({ id: 'membership-1' }),
    };
    const tx = {
      coupon: couponDelegate,
      tenantMembership: tenantMembershipDelegate,
    };
    const prisma = {
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)),
      category: { findUnique: jest.fn() },
    };
    const audit = {
      logTenantAction: jest
        .fn()
        .mockRejectedValueOnce(new Error('audit db down')),
    };
    const service = new CouponsService(prisma as never, audit as never);

    await expect(
      service.createCoupon(
        {
          tenantId: 'tenant-a',
          source: 'membership-default',
          membership: { role: 'OWNER' },
        },
        {
          id: 'user-1',
          email: 'owner@example.test',
          role: 'ADMIN',
          platformRole: null,
          memberships: [{ tenantId: 'tenant-a', role: 'OWNER' }],
        },
        {
          code: 'SAVE10',
          type: CouponType.PERCENTAGE,
          percentageOff: 10,
          scopeType: CouponScopeType.STORE_WIDE,
        },
      ),
    ).rejects.toThrow('audit db down');
    expect(couponDelegate.create).toHaveBeenCalled();
  });
});

describe('CouponsService.createCoupon — storeId (P8-4.1)', () => {
  const tenantContext = {
    tenantId: 'tenant-a',
    source: 'membership-default' as const,
    membership: { role: 'OWNER' as const },
  };
  const actor = {
    id: 'user-1',
    email: 'owner@example.test',
    role: 'ADMIN' as const,
    platformRole: null,
    memberships: [{ tenantId: 'tenant-a', role: 'OWNER' as const }],
  };
  const dto = {
    code: 'SAVE10',
    type: CouponType.PERCENTAGE,
    percentageOff: 10,
    scopeType: CouponScopeType.STORE_WIDE,
  };

  function makePrisma(createResult?: Record<string, unknown>) {
    const couponDelegate = {
      create: jest.fn().mockResolvedValue(
        createResult ?? { id: 'coupon-1', code: 'SAVE10', storeId: 'store-a-primary' },
      ),
    };
    const tx = {
      coupon: couponDelegate,
      tenantMembership: { findUnique: jest.fn().mockResolvedValue({ id: 'membership-1' }) },
    };
    return {
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)),
      category: { findUnique: jest.fn() },
      _couponDelegate: couponDelegate,
    };
  }

  beforeEach(() => {
    mockStoreClient.findFirst.mockReset();
  });

  it("resolves and persists the caller's own tenant's primary storeId — never client-supplied (CreateCouponDto has no storeId field)", async () => {
    mockStoreClient.findFirst.mockResolvedValue({ id: 'store-a-primary' });
    const prisma = makePrisma();
    const audit = { logTenantAction: jest.fn().mockResolvedValue(undefined) };
    const service = new CouponsService(prisma as never, audit as never);

    await service.createCoupon(tenantContext, actor, dto);

    expect(prisma._couponDelegate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-a',
          storeId: 'store-a-primary',
        }),
      }),
    );
  });

  it('resolves storeId via the tenant-scoped client, scoped to the caller tenant only (never a different tenant\'s store)', async () => {
    mockStoreClient.findFirst.mockResolvedValue({ id: 'store-a-primary' });
    const prisma = makePrisma();
    const audit = { logTenantAction: jest.fn().mockResolvedValue(undefined) };
    const service = new CouponsService(prisma as never, audit as never);

    await service.createCoupon(tenantContext, actor, dto);

    // resolvePrimaryStoreId calls getTenantScopedClient(prisma, tenantId)
    // — the mocked tenant-prisma module records this via jest.mock's own
    // factory; asserting the real call happened (not e.g. a raw
    // `prisma.store.findFirst`) is what proves storeId is server-derived
    // and tenant-scoped, not guessed or globally resolved.
    const { getTenantScopedClient } = jest.requireMock(
      '../common/tenant/tenant-prisma',
    ) as { getTenantScopedClient: jest.Mock };
    expect(getTenantScopedClient).toHaveBeenCalledWith(prisma, 'tenant-a');
  });

  it('fails safely (propagates NotFoundException) for a tenant with no primary store — never silently creates a coupon with a null/guessed storeId', async () => {
    mockStoreClient.findFirst.mockResolvedValue(null);
    const prisma = makePrisma();
    const audit = { logTenantAction: jest.fn().mockResolvedValue(undefined) };
    const service = new CouponsService(prisma as never, audit as never);

    await expect(
      service.createCoupon(tenantContext, actor, dto),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma._couponDelegate.create).not.toHaveBeenCalled();
  });
});
