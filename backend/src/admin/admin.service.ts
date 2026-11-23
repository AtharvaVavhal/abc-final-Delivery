import { Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, PhotoReviewStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../common/database/prisma.service';
import { PaginatedResult } from '../common/types/api-response.interface';
import { TenantContext } from '../common/tenant/tenant-context';
import { getTenantScopedClient } from '../common/tenant/tenant-prisma';
import {
  decimalToPaise,
  paiseToDecimalString,
} from '../cart/pricing/money.util';
import { OrdersService } from '../orders/orders.service';
import { EntitlementService } from '../entitlements/entitlement.service';
import { EntitlementResolution } from '../entitlements/entitlement.types';
import { UsageService } from '../usage/usage.service';
import { PERSISTENT_PERIOD } from '../usage/usage-period';
import {
  LIMIT_KEY_PERIODS,
  LIMIT_KEYS,
} from '../platform/platform-plans/catalogue.constants';
import { ListAdminCustomersQueryDto } from './dto/list-admin-customers-query.dto';
import {
  AdminCustomerDetailView,
  AdminCustomerListItemView,
} from './dto/customer-view.interface';
import {
  AdminDashboardView,
  OrderStatusCount,
} from './dto/dashboard-view.interface';
import { AdminDashboardOverviewView } from './dto/dashboard-overview.interface';
import {
  computeWindows,
  summarisePeriod,
  type OverviewOrderRow,
} from './dashboard-overview.util';
import { AdminSubscriptionView } from './dto/subscription-view.interface';
import { AdminUsageView } from './dto/usage-view.interface';

/** §19/§32: "paid-or-later" — everything from PAID onward in the lifecycle
 * except the two terminal statuses where the money isn't kept. Read off
 * business meaning, not re-derived from order-state-machine.ts (that table
 * encodes legal transitions, not "did this order generate revenue"). */
const REVENUE_ORDER_STATUSES: readonly OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.CONFIRMED,
  OrderStatus.IN_PRODUCTION,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
];

const RECENT_ORDERS_LIMIT = 10;
const RECENT_CUSTOMER_ORDERS_LIMIT = 5;

/**
 * W10 hardening — `User` (customer identity) carries no `tenantId` column
 * at all (Phase 2a/9/12 defer real per-tenant customer identity; SaaS
 * Master Plan §9/D5-a), so "this tenant's customers" cannot be a `where`
 * clause on `User` directly. It CAN be expressed via the one relation
 * that IS tenant-owned already: a customer only counts as "this tenant's"
 * if they have placed at least one order with it. `orderCount` is scoped
 * the same way — otherwise a customer's cross-tenant order volume would
 * leak onto a tenant that has never actually done business with them.
 */
function customerScopeWhere(tenantId: string): Prisma.UserWhereInput {
  return { orders: { some: { tenantId } } };
}

function customerInclude(tenantId: string) {
  return {
    _count: { select: { orders: { where: { tenantId } } } },
  } satisfies Prisma.UserInclude;
}

type CustomerRow = Prisma.UserGetPayload<{
  include: ReturnType<typeof customerInclude>;
}>;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
    private readonly entitlementService: EntitlementService,
    private readonly usageService: UsageService,
  ) {}

  // ─── GET /admin/dashboard (§19, minimal — no charts) ───────────────────

  /**
   * W10 hardening (P0) — the status/revenue aggregates below, and
   * adminRecentOrders, were unconditionally global (no `where.tenantId`
   * at all): every tenant's dashboard showed the WHOLE PLATFORM's order
   * counts, revenue, and recent-orders feed, not just their own.
   */
  async getDashboard(
    tenantContext: TenantContext,
  ): Promise<AdminDashboardView> {
    const [statusCounts, revenueAgg, recentOrders, photosAwaitingReview] =
      await Promise.all([
        this.prisma.order.groupBy({
          by: ['status'],
          where: { tenantId: tenantContext.tenantId },
          _count: { _all: true },
        }),
        this.prisma.order.aggregate({
          where: {
            tenantId: tenantContext.tenantId,
            status: { in: REVENUE_ORDER_STATUSES as OrderStatus[] },
          },
          _sum: { total: true },
        }),
        this.ordersService.adminRecentOrders(
          tenantContext,
          RECENT_ORDERS_LIMIT,
        ),
        this.prisma.orderItemCustomization.count({
          where: {
            tenantId: tenantContext.tenantId,
            uploadedFileId: { not: null },
            reviewStatus: PhotoReviewStatus.PENDING,
            // Only paid orders waiting for production are worth the
            // admin's attention; unpaid/cancelled ones are not.
            orderItem: {
              order: {
                status: { in: [OrderStatus.PAID, OrderStatus.CONFIRMED] },
              },
            },
          },
        }),
      ]);

    const countByStatus = new Map(
      statusCounts.map((row) => [row.status, row._count._all]),
    );
    const ordersByStatus: OrderStatusCount[] = Object.values(OrderStatus).map(
      (status) => ({
        status,
        count: countByStatus.get(status) ?? 0,
      }),
    );
    const totalOrders = statusCounts.reduce(
      (sum, row) => sum + row._count._all,
      0,
    );

    return {
      totalOrders,
      photosAwaitingReview,
      ordersByStatus,
      totalRevenue: paiseToDecimalString(
        decimalToPaise(revenueAgg._sum.total ?? new Prisma.Decimal(0)),
      ),
      recentOrders,
    };
  }

  // ─── GET /admin/dashboard/overview — sales over time ───────────────────

  /**
   * Daily net sales / orders for the last `days` India calendar days and
   * the equal period before it, plus average order value and the share of
   * buyers who had ordered before ("repeat customers").
   *
   * Same "net sales" meaning as {@link getDashboard}'s `totalRevenue`
   * (paid-or-later statuses), scoped to the caller's tenant. Only the
   * columns needed are read, for a bounded window (2 × `days`, at most
   * 180 days), and bucketed in code so the day boundary is India time and
   * the query stays plain Prisma (no raw SQL to bypass tenant scoping).
   */
  async getDashboardOverview(
    tenantContext: TenantContext,
    days: number,
    now: Date = new Date(),
  ): Promise<AdminDashboardOverviewView> {
    const windows = computeWindows(now, days);
    const revenueStatuses = REVENUE_ORDER_STATUSES as OrderStatus[];
    const { tenantId } = tenantContext;

    const rows: OverviewOrderRow[] = await this.prisma.order.findMany({
      where: {
        tenantId,
        status: { in: revenueStatuses },
        createdAt: { gte: windows.previousStart, lt: windows.currentEnd },
      },
      select: { createdAt: true, total: true, userId: true },
    });

    // Customers who also bought before a period began = its repeat buyers.
    const returningBefore = async (
      periodStart: Date,
      periodEnd: Date,
    ): Promise<Set<string>> => {
      const ids = [
        ...new Set(
          rows
            .filter(
              (r) => r.createdAt >= periodStart && r.createdAt < periodEnd,
            )
            .map((r) => r.userId),
        ),
      ];
      if (ids.length === 0) return new Set();
      const prior = await this.prisma.order.groupBy({
        by: ['userId'],
        where: {
          tenantId,
          status: { in: revenueStatuses },
          userId: { in: ids },
          createdAt: { lt: periodStart },
        },
      });
      return new Set(prior.map((row) => row.userId));
    };

    const [currentReturning, previousReturning] = await Promise.all([
      returningBefore(windows.currentStart, windows.currentEnd),
      returningBefore(windows.previousStart, windows.currentStart),
    ]);

    return {
      days,
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      current: summarisePeriod(
        rows,
        windows.currentStart,
        days,
        currentReturning,
      ),
      previous: summarisePeriod(
        rows,
        windows.previousStart,
        days,
        previousReturning,
      ),
    };
  }

  // ─── GET /admin/customers[/:id] (§19, read-only) ────────────────────────

  /**
   * W10 hardening (P0) — this list, and getCustomerDetail below, were
   * unconditionally global across ALL tenants (no scoping at all — `User`
   * has no `tenantId` column to filter by): any tenant with
   * `customers:read` could browse every customer on the whole platform,
   * including their email/address/phone and order history with OTHER
   * tenants. Scoped via `customerScopeWhere`/`customerInclude` above (has
   * an order with this tenant).
   */
  async listCustomers(
    tenantContext: TenantContext,
    query: ListAdminCustomersQueryDto,
  ): Promise<PaginatedResult<AdminCustomerListItemView>> {
    const where: Prisma.UserWhereInput = {
      role: Role.CUSTOMER,
      ...customerScopeWhere(tenantContext.tenantId),
      ...(query.search
        ? { email: { contains: query.search, mode: 'insensitive' } }
        : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: customerInclude(tenantContext.tenantId),
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toCustomerListItemView(row)),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  async getCustomerDetail(
    tenantContext: TenantContext,
    id: string,
  ): Promise<AdminCustomerDetailView> {
    // Scoped to role=CUSTOMER + "has an order with this tenant", same as
    // the list — an admin id, another tenant's customer, or a customer
    // this tenant has never done business with all 404 here rather than
    // leaking another admin's profile or another tenant's customer
    // relationship through this endpoint.
    const user = await this.prisma.user.findFirst({
      where: {
        id,
        role: Role.CUSTOMER,
        ...customerScopeWhere(tenantContext.tenantId),
      },
      include: customerInclude(tenantContext.tenantId),
    });
    if (!user) {
      throw new NotFoundException('Customer not found');
    }

    const [revenueAgg, recentOrders] = await Promise.all([
      this.prisma.order.aggregate({
        where: {
          userId: id,
          tenantId: tenantContext.tenantId,
          status: { in: REVENUE_ORDER_STATUSES as OrderStatus[] },
        },
        _sum: { total: true },
      }),
      this.ordersService.adminListOrdersForCustomer(tenantContext, id, {
        page: 1,
        limit: RECENT_CUSTOMER_ORDERS_LIMIT,
      }),
    ]);

    return {
      ...this.toCustomerListItemView(user),
      totalSpend: paiseToDecimalString(
        decimalToPaise(revenueAgg._sum.total ?? new Prisma.Decimal(0)),
      ),
      recentOrders: recentOrders.items,
    };
  }

  private toCustomerListItemView(user: CustomerRow): AdminCustomerListItemView {
    return {
      id: user.id,
      email: user.email,
      addressLine1: user.addressLine1,
      addressLine2: user.addressLine2,
      city: user.city,
      state: user.state,
      postalCode: user.postalCode,
      country: user.country,
      phone: user.phone,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
      orderCount: user._count.orders,
    };
  }

  // ─── Phase 6 W6 — GET /admin/subscription|usage|entitlements ───────────
  //
  // Composes EntitlementService/UsageService; reimplements neither's own
  // resolution logic (§6/§8/§10 of the W6 authorization). Read-only — no
  // method below ever calls a `.create`/`.update`/`.delete`/`.upsert` on
  // Subscription/Plan/PlanFeature/PlanLimit/TenantEntitlementOverride/Usage.

  /**
   * Subscription is one of `tenant-prisma.ts`'s own scoped models (the
   * same mechanism `EntitlementService.resolveEffectivePlanId` already
   * uses) — scoped by the server-derived `tenantContext.tenantId`, never a
   * client-supplied value. A tenant with no `Subscription` row at all is a
   * deployment-configuration defect (every tenant gets one at bootstrap —
   * `seed-tenant-bootstrap.ts`), reported as 404 rather than silently
   * fabricating a response.
   */
  async getSubscription(
    tenantContext: TenantContext,
  ): Promise<AdminSubscriptionView> {
    const scoped = getTenantScopedClient(this.prisma, tenantContext.tenantId);
    const subscription = await scoped.subscription.findUnique({
      where: { tenantId: tenantContext.tenantId },
      select: {
        status: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        plan: { select: { key: true, name: true } },
      },
    });
    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }
    return {
      status: subscription.status,
      plan: subscription.plan,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
    };
  }

  /**
   * One `UsageService.getUsage()` read per PERSISTENT-classified limit key
   * (never a duplicated query — `UsageService` remains the sole `Usage`
   * reader) — read-only by construction (`getUsage` itself never creates a
   * row; see its own doc comment). `orders_per_month` (the sole
   * BILLING_PERIOD key) is never queried at all: there is no valid
   * `period` string to pass it (P6-D3 Part B, `usage/usage-period.ts`), so
   * inventing one here would be exactly the "calendar-month logic" §5
   * forbids. Its entry is `count: null` — never a real query, never a
   * fabricated 0.
   */
  async getUsage(tenantContext: TenantContext): Promise<AdminUsageView> {
    const result = {} as AdminUsageView;
    for (const limitKey of LIMIT_KEYS) {
      const period = LIMIT_KEY_PERIODS[limitKey];
      if (period === 'BILLING_PERIOD') {
        result[limitKey] = { count: null, period };
        continue;
      }
      const { count } = await this.usageService.getUsage(
        this.prisma,
        tenantContext.tenantId,
        limitKey,
        PERSISTENT_PERIOD,
      );
      result[limitKey] = { count, period };
    }
    return result;
  }

  /**
   * `EntitlementService.resolve()` IS the response — no reshaping, no
   * reimplementation of PlanFeature/PlanLimit/override resolution (§6).
   */
  async getEntitlements(
    tenantContext: TenantContext,
  ): Promise<EntitlementResolution> {
    return this.entitlementService.resolve(tenantContext.tenantId);
  }
}
