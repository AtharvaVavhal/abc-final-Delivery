import { NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma, Role } from '@prisma/client';
import { AdminService } from './admin.service';
import { TenantContext } from '../common/tenant/tenant-context';

const TENANT_ID = 'tenant-a';
const tenantContext: TenantContext = {
  tenantId: TENANT_ID,
  source: 'membership-default',
  membership: { role: 'OWNER' },
};

const FULL_CUSTOMER_ROW = {
  id: 'user-1',
  email: 'customer@example.com',
  passwordHash: '$2b$12$superSecretHashValue',
  role: Role.CUSTOMER,
  tokenVersion: 3,
  failedLoginAttempts: 2,
  passwordResetTokenHash: 'someResetTokenHash',
  passwordResetExpiresAt: new Date('2026-01-01T00:00:00Z'),
  addressLine1: '123 MG Road',
  addressLine2: null,
  city: 'Pune',
  state: 'Maharashtra',
  postalCode: '411001',
  country: 'India',
  phone: '9876543210',
  isActive: true,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-06-01T00:00:00Z'),
  _count: { orders: 4 },
};

interface BuildServiceOptions {
  findMany?: unknown[];
  count?: number;
  findFirst?: unknown;
  groupBy?: { status: OrderStatus; _count: { _all: number } }[];
  aggregateSum?: Prisma.Decimal | null;
  recentOrders?: unknown[];
  subscriptionFindUnique?: unknown;
  resolveResult?: unknown;
  usageResult?: { count: number };
}

function buildService({
  findMany = [],
  count = 0,
  findFirst = null,
  groupBy = [],
  aggregateSum = null,
  recentOrders = [],
  subscriptionFindUnique = null,
  resolveResult = { features: {}, limits: {} },
  usageResult = { count: 0 },
}: BuildServiceOptions = {}) {
  // Phase 6 W6 — `getSubscription` calls `getTenantScopedClient(this.prisma,
  // tenantId)`, which calls `this.prisma.$extends(...)` internally — mocked
  // exactly the way `entitlement.service.spec.ts`/`app-setting.service.spec
  // .ts` already establish for the same D4 tenant-scoped-client mechanism:
  // `$extends` returns a plain object exposing just the delegate the
  // middleware forwards calls through to. The real scoping behavior itself
  // is exercised for real in `test/e2e/entitlement-engine.e2e-spec.ts`-style
  // Postgres e2e coverage, not here.
  const subscriptionDelegate = {
    findUnique: jest.fn().mockResolvedValue(subscriptionFindUnique),
  };
  const prisma = {
    user: {
      findMany: jest.fn().mockResolvedValue(findMany),
      count: jest.fn().mockResolvedValue(count),
      findFirst: jest.fn().mockResolvedValue(findFirst),
    },
    order: {
      groupBy: jest.fn().mockResolvedValue(groupBy),
      aggregate: jest
        .fn<Promise<{ _sum: { total: Prisma.Decimal | null } }>, [unknown]>()
        .mockResolvedValue({ _sum: { total: aggregateSum } }),
    },
    orderItemCustomization: {
      count: jest.fn().mockResolvedValue(0),
    },
    $extends: jest.fn().mockReturnValue({ subscription: subscriptionDelegate }),
  };
  const ordersService = {
    adminRecentOrders: jest.fn().mockResolvedValue(recentOrders),
    adminListOrdersForCustomer: jest
      .fn()
      .mockResolvedValue({ items: recentOrders, meta: {} }),
  };
  const entitlementService = {
    resolve: jest.fn().mockResolvedValue(resolveResult),
  };
  const usageService = {
    getUsage: jest.fn().mockResolvedValue(usageResult),
  };
  const service = new AdminService(
    prisma as never,
    ordersService as never,
    entitlementService as never,
    usageService as never,
  );
  return {
    service,
    prisma,
    ordersService,
    entitlementService,
    usageService,
    subscriptionDelegate,
  };
}

describe('AdminService.getDashboard — aggregation against seeded fixtures', () => {
  it('sums order count across all statuses returned by groupBy', async () => {
    const { service } = buildService({
      groupBy: [
        { status: OrderStatus.PAID, _count: { _all: 3 } },
        { status: OrderStatus.DELIVERED, _count: { _all: 2 } },
        { status: OrderStatus.CANCELLED, _count: { _all: 1 } },
      ],
    });

    const dashboard = await service.getDashboard(tenantContext);

    expect(dashboard.totalOrders).toBe(6);
  });

  it('zero-fills every OrderStatus, not just the ones with orders', async () => {
    const { service } = buildService({
      groupBy: [{ status: OrderStatus.PAID, _count: { _all: 3 } }],
    });

    const dashboard = await service.getDashboard(tenantContext);

    expect(dashboard.ordersByStatus).toHaveLength(
      Object.values(OrderStatus).length,
    );
    expect(dashboard.ordersByStatus).toContainEqual({
      status: OrderStatus.PAID,
      count: 3,
    });
    expect(dashboard.ordersByStatus).toContainEqual({
      status: OrderStatus.REFUNDED,
      count: 0,
    });
    expect(dashboard.ordersByStatus).toContainEqual({
      status: OrderStatus.PENDING_PAYMENT,
      count: 0,
    });
  });

  it('converts the paid-or-later revenue sum from Decimal to a major-unit string, scoped to the caller tenant', async () => {
    const { service, prisma } = buildService({
      aggregateSum: new Prisma.Decimal('12345.67'),
    });

    const dashboard = await service.getDashboard(tenantContext);

    expect(dashboard.totalRevenue).toBe('12345.67');
    expect(prisma.order.aggregate).toHaveBeenCalledWith({
      where: {
        tenantId: TENANT_ID,
        status: {
          in: [
            OrderStatus.PAID,
            OrderStatus.CONFIRMED,
            OrderStatus.IN_PRODUCTION,
            OrderStatus.SHIPPED,
            OrderStatus.DELIVERED,
          ],
        },
      },
      _sum: { total: true },
    });
  });

  it('reports zero revenue instead of throwing when no order matches (aggregate _sum is null)', async () => {
    const { service } = buildService({ aggregateSum: null });

    const dashboard = await service.getDashboard(tenantContext);

    expect(dashboard.totalRevenue).toBe('0.00');
  });

  it('scopes the status-count groupBy to the caller tenant (W10 hardening)', async () => {
    const { service, prisma } = buildService();

    await service.getDashboard(tenantContext);

    expect(prisma.order.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: TENANT_ID } }),
    );
  });

  it('surfaces the last 10 recent orders from OrdersService, scoped to the caller tenant, newest first, unmodified', async () => {
    const recentOrders = [{ id: 'order-9' }, { id: 'order-1' }];
    const { service, ordersService } = buildService({ recentOrders });

    const dashboard = await service.getDashboard(tenantContext);

    expect(ordersService.adminRecentOrders).toHaveBeenCalledWith(
      tenantContext,
      10,
    );
    expect(dashboard.recentOrders).toBe(recentOrders);
  });
});

describe('AdminService.listCustomers — read-only, admin-excluded, tenant-scoped, no sensitive fields', () => {
  it('filters to role=CUSTOMER, scoped to customers with an order in the caller tenant (W10 hardening)', async () => {
    const { service, prisma } = buildService();

    await service.listCustomers(tenantContext, { page: 1, limit: 20 });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          role: Role.CUSTOMER,
          orders: { some: { tenantId: TENANT_ID } },
        },
      }),
    );
  });

  it('applies email search and isActive filters when provided, still tenant-scoped', async () => {
    const { service, prisma } = buildService();

    await service.listCustomers(tenantContext, {
      page: 1,
      limit: 20,
      search: 'alice',
      isActive: false,
    });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          role: Role.CUSTOMER,
          orders: { some: { tenantId: TENANT_ID } },
          email: { contains: 'alice', mode: 'insensitive' },
          isActive: false,
        },
      }),
    );
  });

  it("counts orders scoped to the caller tenant only, never a customer's cross-tenant total (W10 hardening)", async () => {
    const { service, prisma } = buildService();

    await service.listCustomers(tenantContext, { page: 1, limit: 20 });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: {
          _count: { select: { orders: { where: { tenantId: TENANT_ID } } } },
        },
      }),
    );
  });

  it('never leaks passwordHash, tokenVersion, failedLoginAttempts, or reset-token fields', async () => {
    const { service } = buildService({
      findMany: [FULL_CUSTOMER_ROW],
      count: 1,
    });

    const { items } = await service.listCustomers(tenantContext, {
      page: 1,
      limit: 20,
    });

    expect(items[0]).not.toHaveProperty('passwordHash');
    expect(items[0]).not.toHaveProperty('tokenVersion');
    expect(items[0]).not.toHaveProperty('failedLoginAttempts');
    expect(items[0]).not.toHaveProperty('passwordResetTokenHash');
    expect(items[0]).not.toHaveProperty('passwordResetExpiresAt');
  });

  it('includes isActive and orderCount, unlike the self-service profile view', async () => {
    const { service } = buildService({
      findMany: [FULL_CUSTOMER_ROW],
      count: 1,
    });

    const { items } = await service.listCustomers(tenantContext, {
      page: 1,
      limit: 20,
    });

    expect(items[0]).toMatchObject({
      id: 'user-1',
      email: 'customer@example.com',
      isActive: true,
      orderCount: 4,
    });
  });
});

describe('AdminService.getCustomerDetail', () => {
  it('throws NotFoundException when the id does not belong to a CUSTOMER account (including admin ids)', async () => {
    const { service } = buildService({ findFirst: null });

    await expect(
      service.getCustomerDetail(tenantContext, 'missing-or-admin-id'),
    ).rejects.toThrow(NotFoundException);
  });

  it("throws NotFoundException for a customer who exists but has never ordered from the caller's tenant (W10 hardening — cross-tenant customer lookup fails safe)", async () => {
    const { service, prisma } = buildService({ findFirst: null });

    await expect(
      service.getCustomerDetail(tenantContext, 'other-tenant-customer'),
    ).rejects.toThrow(NotFoundException);
    const [call] = prisma.user.findFirst.mock.calls[0] as [
      { where: { id: string; orders: { some: { tenantId: string } } } },
    ];
    expect(call.where.id).toBe('other-tenant-customer');
    expect(call.where.orders).toEqual({ some: { tenantId: TENANT_ID } });
  });

  it('computes totalSpend from paid-or-later orders scoped to the caller tenant and includes recent orders', async () => {
    const recentOrders = [{ id: 'order-1' }];
    const { service, prisma, ordersService } = buildService({
      findFirst: FULL_CUSTOMER_ROW,
      aggregateSum: new Prisma.Decimal('999.50'),
      recentOrders,
    });

    const detail = await service.getCustomerDetail(tenantContext, 'user-1');

    expect(detail.totalSpend).toBe('999.50');
    expect(detail.recentOrders).toBe(recentOrders);
    expect(detail).not.toHaveProperty('passwordHash');
    const aggregateArgs = prisma.order.aggregate.mock.calls[0][0] as {
      where: { userId: string; tenantId: string };
    };
    expect(aggregateArgs.where.userId).toBe('user-1');
    expect(aggregateArgs.where.tenantId).toBe(TENANT_ID);
    expect(ordersService.adminListOrdersForCustomer).toHaveBeenCalledWith(
      tenantContext,
      'user-1',
      expect.objectContaining({ page: 1 }),
    );
  });
});

/**
 * Phase 6 W6 — GET /admin/subscription|usage|entitlements. Mocked-Prisma/
 * mocked-service unit tests, same convention as every `describe` block
 * above. Real-Postgres HTTP-boundary coverage (guard chain, tenant
 * isolation, spoofed-tenantId rejection, permission matrix) lives in
 * `test/e2e/tenant-entitlement-api.e2e-spec.ts`.
 */
describe('AdminService — GET /admin/subscription|usage|entitlements (Phase 6 W6)', () => {
  describe('getSubscription', () => {
    it('returns the tenant-scoped subscription state, shaped to the view contract only — no internal ids', async () => {
      const { service, subscriptionDelegate } = buildService({
        subscriptionFindUnique: {
          status: 'ACTIVE',
          currentPeriodStart: new Date('2026-01-01T00:00:00Z'),
          currentPeriodEnd: null,
          plan: { key: 'free', name: 'Free' },
        },
      });

      const result = await service.getSubscription(tenantContext);

      expect(result).toEqual({
        status: 'ACTIVE',
        plan: { key: 'free', name: 'Free' },
        currentPeriodStart: new Date('2026-01-01T00:00:00Z'),
        currentPeriodEnd: null,
      });
      expect(result).not.toHaveProperty('id');
      expect(result).not.toHaveProperty('tenantId');
      expect(result).not.toHaveProperty('planId');
      expect(subscriptionDelegate.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: TENANT_ID } }),
      );
    });

    it('never queries any tenant other than the server-derived one', async () => {
      const { service, prisma, subscriptionDelegate } = buildService({
        subscriptionFindUnique: {
          status: 'ACTIVE',
          currentPeriodStart: null,
          currentPeriodEnd: null,
          plan: { key: 'free', name: 'Free' },
        },
      });

      await service.getSubscription(tenantContext);

      // `getTenantScopedClient` is invoked (proving the D4 scoping
      // mechanism is used, not a raw unscoped query), and the delegate it
      // hands back is queried with exactly this tenant's id — never a
      // second, different tenant id from anywhere else.
      expect(prisma.$extends).toHaveBeenCalledTimes(1);
      const [callArgs] = subscriptionDelegate.findUnique.mock.calls[0] as [
        { where: { tenantId: string } },
      ];
      expect(callArgs.where.tenantId).toBe(TENANT_ID);
    });

    it('a missing Subscription row 404s rather than fabricating a response', async () => {
      const { service } = buildService({ subscriptionFindUnique: null });

      await expect(service.getSubscription(tenantContext)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getUsage', () => {
    it('reads every PERSISTENT limit key through UsageService.getUsage with the server-derived tenantId and the fixed PERSISTENT period', async () => {
      const { service, usageService } = buildService({
        usageResult: { count: 7 },
      });

      const result = await service.getUsage(tenantContext);

      for (const limitKey of [
        'products',
        'team_members',
        'storage_mb',
        'custom_domains',
      ]) {
        expect(usageService.getUsage).toHaveBeenCalledWith(
          expect.anything(),
          TENANT_ID,
          limitKey,
          'persistent',
        );
        expect(result[limitKey as keyof typeof result]).toEqual({
          count: 7,
          period: 'PERSISTENT',
        });
      }
    });

    it('never queries orders_per_month through UsageService — no billing-period identifier exists to pass it (P6-D3 Part B) — and reports count: null, never a fabricated 0', async () => {
      const { service, usageService } = buildService({
        usageResult: { count: 0 },
      });

      const result = await service.getUsage(tenantContext);

      expect(usageService.getUsage).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'orders_per_month',
        expect.anything(),
      );
      expect(result.orders_per_month).toEqual({
        count: null,
        period: 'BILLING_PERIOD',
      });
    });

    it('never calls a Usage-mutating method — the mock exposes only getUsage, so any write attempt would throw, not merely go unasserted', async () => {
      const { service, usageService } = buildService();

      await service.getUsage(tenantContext);

      expect(usageService.getUsage).toHaveBeenCalled();
      // No `reserve`/`decrement` exists on the mock at all — if getUsage()
      // ever called through to one, this test would already have thrown a
      // TypeError before reaching this assertion.
      expect(usageService).not.toHaveProperty('reserve');
      expect(usageService).not.toHaveProperty('decrement');
    });
  });

  describe('getEntitlements', () => {
    it('returns EXACTLY what EntitlementService.resolve() resolves, for the server-derived tenantId — no reshaping, no duplicated resolution logic', async () => {
      const resolveResult = {
        features: { coupons: true, team_members: false },
        limits: {
          products: { value: 100, period: 'PERSISTENT' },
          storage_mb: { value: null, period: 'PERSISTENT' }, // unlimited
          custom_domains: { value: 0, period: 'PERSISTENT' }, // missing/denied
        },
      };
      const { service, entitlementService } = buildService({ resolveResult });

      const result = await service.getEntitlements(tenantContext);

      expect(result).toBe(resolveResult); // reference equality — zero transformation
      expect(entitlementService.resolve).toHaveBeenCalledWith(TENANT_ID);
      expect(entitlementService.resolve).toHaveBeenCalledTimes(1);
    });
  });
});
