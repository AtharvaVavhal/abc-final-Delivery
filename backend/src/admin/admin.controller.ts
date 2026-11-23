import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { CurrentTenant } from '../common/decorators/current-tenant.decorator';
import type { TenantContext } from '../common/tenant/tenant-context';
import { RequirePermission } from '../auth/permissions/require-permission.decorator';
import { RequireFeature } from '../entitlements/require-feature.decorator';
import { IDEMPOTENCY_KEY_HEADER } from '../common/constants/app.constants';
import { OrdersService } from '../orders/orders.service';
import { ReviewsService } from '../reviews/reviews.service';
import { UpdateReviewStatusDto } from '../reviews/dto/update-review-status.dto';
import { CouponsService } from '../coupons/coupons.service';
import { CreateCouponDto } from '../coupons/dto/create-coupon.dto';
import { UpdateCouponDto } from '../coupons/dto/update-coupon.dto';
import { ListAdminCouponsQueryDto } from '../coupons/dto/list-admin-coupons-query.dto';
import { AppSettingService } from '../app-setting/app-setting.service';
import { UpdateSettingDto } from '../app-setting/dto/update-setting.dto';
import { InvoicesService } from '../invoices/invoices.service';
import { RefundsService } from '../payments/refunds/refunds.service';
import { CreateRefundDto } from '../payments/refunds/dto/create-refund.dto';
import { SubscriptionOrchestrationService } from '../subscriptions/subscription-orchestration.service';
import { UpgradeSubscriptionDto } from '../subscriptions/dto/upgrade-subscription.dto';
import { DowngradeSubscriptionDto } from '../subscriptions/dto/downgrade-subscription.dto';
import { CancelSubscriptionDto } from '../subscriptions/dto/cancel-subscription.dto';
import { AdminService } from './admin.service';
import { ListAdminOrdersQueryDto } from './dto/list-admin-orders-query.dto';
import { DashboardOverviewQueryDto } from './dto/dashboard-overview-query.dto';
import { ListAdminCustomersQueryDto } from './dto/list-admin-customers-query.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

/**
 * Owns (§19/§20): GET /admin/orders, GET /admin/orders/:id, PATCH
 * /admin/orders/:id/status (CAS-idempotent — already-applied transition
 * → 200, illegal → 409, and a target status of REFUNDED also closes out
 * the order's PENDING Refund row — see OrdersService.performRefundRecording
 * — §13.L/§32's "record only, no in-app refund-initiation API"; unchanged
 * by Phase 8), POST /admin/payment-attempts/:id/refund (Phase 8, P8-11 —
 * the actual in-app Razorpay refund call, via the payment's own
 * historically-bound PaymentAccount, delegated to RefundsService — a
 * separate, explicit action from the REFUNDED status transition above,
 * not a replacement for it), GET
 * /admin/dashboard (minimal — no charts), GET /admin/customers[/:id]
 * (read-only), PATCH /admin/reviews/:id/status (moderation; unlike order
 * status there's no transition graph to enforce, any ReviewStatus to any
 * ReviewStatus is valid), and — as of Phase 10's Coupons half — GET/POST
 * /admin/coupons[/:id] and PATCH /admin/coupons/:id (full CRUD; `code`/
 * `type` are immutable after creation, enforced by UpdateCouponDto's
 * whitelist, not by anything in this controller). Order/review/coupon
 * mutation delegates to OrdersService/ReviewsService/CouponsService —
 * same pattern as CategoriesController sharing ProductsService in Phase 2 —
 * not duplicated into AdminService; dashboard/customer aggregation is
 * AdminService's own logic, per the admin.module.ts dependency-graph note.
 *
 * Route guards are UX-only on the frontend — every route here independently
 * enforces its own permission check server-side via `PermissionsGuard`
 * (Phase 3; decisions P2-D9, G-13, G-20, docs/saas/DECISIONS.md). Prior to
 * Phase 3 this whole controller carried one controller-level
 * `@Roles(Role.ADMIN)`; the ratified permission catalogue (G-13)
 * distinguishes actions this controller previously treated identically
 * (e.g. viewing the dashboard vs. writing a coupon), so the single
 * decorator is replaced by one `@RequirePermission(...)` per route below —
 * an intentional, ratified granularity increase, not a functional change
 * to what an `OWNER`/`ADMIN` membership can already do.
 */
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly ordersService: OrdersService,
    private readonly reviewsService: ReviewsService,
    private readonly couponsService: CouponsService,
    private readonly appSettingService: AppSettingService,
    private readonly invoicesService: InvoicesService,
    private readonly subscriptionOrchestrationService: SubscriptionOrchestrationService,
    private readonly refundsService: RefundsService,
  ) {}

  /** Every Stage 2 mutation route requires this header — same convention,
   * same constant, as `checkout.controller.ts`'s own required-header
   * check (`POST /checkout/orders`). Kept here rather than in the
   * orchestration service so `SubscriptionOrchestrationService` never
   * needs to know about HTTP headers/exceptions at all. */
  private requireIdempotencyKey(idempotencyKey: string | undefined): string {
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new BadRequestException(
        `${IDEMPOTENCY_KEY_HEADER} header is required`,
      );
    }
    return idempotencyKey;
  }

  @RequirePermission('orders:read')
  @Get('orders')
  async listOrders(
    @CurrentTenant() tenant: TenantContext,
    @Query() query: ListAdminOrdersQueryDto,
  ) {
    return this.ordersService.adminListOrders(tenant, query);
  }

  @RequirePermission('orders:read')
  @Get('orders/:id')
  async orderDetail(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ordersService.adminGetOrderDetail(tenant, id);
  }

  /** Admin view of any order's invoice (idempotent lazy creation for a
   * paid order). Phase 13.4. */
  @RequirePermission('orders:read')
  @Get('orders/:id/invoice')
  async orderInvoice(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invoicesService.getInvoiceForOrder(id, {
      userId: admin.id,
      isAdmin: true,
      tenantId: tenant.tenantId,
    });
  }

  @RequirePermission('orders:transition')
  @Patch('orders/:id/status')
  async updateOrderStatus(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.adminTransitionStatus(tenant, admin, id, dto);
  }

  /**
   * Phase 8 (P8-11) — the merchant commerce in-app refund business
   * workflow. Same `orders:transition` permission as the status-
   * transition route above (no new permission introduced) — refunding a
   * captured payment is exactly the same class of financially-
   * consequential order/payment-lifecycle action already gated by it.
   * Delegates entirely to `RefundsService`, which resolves the
   * PaymentAttempt's OWN historically-bound `PaymentAccount` (never the
   * store's current one) and calls Razorpay through that account's own
   * adapter/credentials — this controller performs no provider-calling
   * or resolution logic itself, same delegation discipline every other
   * route here already follows.
   */
  @RequirePermission('orders:transition')
  @Post('payment-attempts/:id/refund')
  async refundPaymentAttempt(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateRefundDto,
  ) {
    return this.refundsService.createRefund(tenant, admin, id, dto);
  }

  @RequirePermission('dashboard:read')
  @Get('dashboard/overview')
  async dashboardOverview(
    @CurrentTenant() tenant: TenantContext,
    @Query() query: DashboardOverviewQueryDto,
  ) {
    return this.adminService.getDashboardOverview(tenant, query.days);
  }

  @RequirePermission('dashboard:read')
  @Get('dashboard')
  async dashboard(@CurrentTenant() tenant: TenantContext) {
    return this.adminService.getDashboard(tenant);
  }

  // ─── Phase 6 W6 — read-only SaaS entitlement APIs ───────────────────────
  //
  // Same `dashboard:read` permission as the dashboard above (ratified —
  // G-13, docs/saas/DECISIONS.md; no new permission introduced). Three
  // separate endpoints, deliberately never merged into one (§8): each is a
  // thin pass-through to its own AdminService method, which in turn
  // composes EntitlementService/UsageService rather than reimplementing
  // either.

  @RequirePermission('dashboard:read')
  @Get('subscription')
  async subscription(@CurrentTenant() tenant: TenantContext) {
    return this.adminService.getSubscription(tenant);
  }

  @RequirePermission('dashboard:read')
  @Get('usage')
  async usage(@CurrentTenant() tenant: TenantContext) {
    return this.adminService.getUsage(tenant);
  }

  @RequirePermission('dashboard:read')
  @Get('entitlements')
  async entitlements(@CurrentTenant() tenant: TenantContext) {
    return this.adminService.getEntitlements(tenant);
  }

  // ─── Phase 7 Stage 2 (docs/saas/DECISIONS.md P7-D2) — subscription
  // mutation APIs ────────────────────────────────────────────────────────
  //
  // `billing:manage` (P7-D2 Part A), NOT `dashboard:read` — these are
  // writes, not reads, and a distinct permission was ratified specifically
  // so they are NOT gated by the same permission the read-only routes
  // above use. Every route below delegates entirely to
  // `SubscriptionOrchestrationService` — this controller performs no
  // orchestration, provider-calling, or state-machine logic itself, the
  // same delegation discipline `OrdersService`/`ReviewsService`/
  // `CouponsService` already established above. `tenant.tenantId` is
  // always server-derived via `@CurrentTenant()`, `admin.id` via
  // `@CurrentUser()` — never accepted from the request body (no route
  // below has a `tenantId`/`userId`/`providerCustomerId`/
  // `providerSubscriptionId` field in its DTO).

  @RequirePermission('billing:manage')
  @Post('subscription/upgrade')
  async upgradeSubscription(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() admin: AuthenticatedUser,
    @Body() dto: UpgradeSubscriptionDto,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
  ) {
    return this.subscriptionOrchestrationService.upgrade(
      tenant.tenantId,
      admin.id,
      dto,
      this.requireIdempotencyKey(idempotencyKey),
    );
  }

  @RequirePermission('billing:manage')
  @Post('subscription/downgrade')
  async downgradeSubscription(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() admin: AuthenticatedUser,
    @Body() dto: DowngradeSubscriptionDto,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
  ) {
    return this.subscriptionOrchestrationService.downgrade(
      tenant.tenantId,
      admin.id,
      dto,
      this.requireIdempotencyKey(idempotencyKey),
    );
  }

  @RequirePermission('billing:manage')
  @Post('subscription/cancel')
  async cancelSubscription(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() admin: AuthenticatedUser,
    @Body() dto: CancelSubscriptionDto,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
  ) {
    return this.subscriptionOrchestrationService.cancel(
      tenant.tenantId,
      admin.id,
      dto,
      this.requireIdempotencyKey(idempotencyKey),
    );
  }

  /** Phase 7 — Cancellation Retention + Unscheduling wave
   * (docs/saas/DECISIONS.md P7-D3 Part E). Same route family, same
   * `billing:manage` permission, same idempotency-key requirement as
   * every other mutation route above — no new permission introduced. */
  @RequirePermission('billing:manage')
  @Post('subscription/cancel/unschedule')
  async unscheduleCancellation(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() admin: AuthenticatedUser,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
  ) {
    return this.subscriptionOrchestrationService.unscheduleCancellation(
      tenant.tenantId,
      admin.id,
      this.requireIdempotencyKey(idempotencyKey),
    );
  }

  @RequirePermission('billing:manage')
  @Post('subscription/resume')
  async resumeSubscription(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() admin: AuthenticatedUser,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
  ) {
    return this.subscriptionOrchestrationService.resume(
      tenant.tenantId,
      admin.id,
      this.requireIdempotencyKey(idempotencyKey),
    );
  }

  @RequirePermission('customers:read')
  @Get('customers')
  async listCustomers(
    @CurrentTenant() tenant: TenantContext,
    @Query() query: ListAdminCustomersQueryDto,
  ) {
    return this.adminService.listCustomers(tenant, query);
  }

  @RequirePermission('customers:read')
  @Get('customers/:id')
  async customerDetail(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adminService.getCustomerDetail(tenant, id);
  }

  @RequirePermission('reviews:moderate')
  @Patch('reviews/:id/status')
  async updateReviewStatus(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReviewStatusDto,
  ) {
    return this.reviewsService.adminUpdateStatus(tenant, admin, id, dto);
  }

  @RequirePermission('coupons:read')
  @Get('coupons')
  async listCoupons(
    @CurrentTenant() tenant: TenantContext,
    @Query() query: ListAdminCouponsQueryDto,
  ) {
    return this.couponsService.listCoupons(tenant, query);
  }

  @RequirePermission('coupons:read')
  @Get('coupons/:id')
  async couponDetail(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.couponsService.getCoupon(tenant, id);
  }

  // Phase 6 W8 — the `coupons` feature gate is deliberately applied to
  // CREATION only, never to read (`listCoupons`/`couponDetail` above) or
  // update below. This matches the ratified "downgrade non-destructive"
  // exit criterion: a tenant who loses the `coupons` feature keeps full
  // visibility into and management of coupons they already created (e.g.
  // deactivating one before it causes a problem) — only making brand-NEW
  // coupons is blocked. `PermissionsGuard` (`coupons:write`, RBAC — "is
  // this role allowed to touch coupons at all") and `EntitlementGuard`
  // (`coupons` feature — "does this tenant's plan include coupons at all")
  // are independent, composing guards; a denial from either one is
  // sufficient, and `PermissionsGuard` always runs first (app.module.ts's
  // fixed guard order), so a permission failure is never reported as
  // upgrade_required or vice versa. The ratified Free plan currently sets
  // `coupons: true`, so this introduces no behavior change for any tenant
  // on the plan catalogue as it exists today — it activates only once a
  // future plan sets `coupons: false` (a business/product decision, not
  // made here).
  @RequirePermission('coupons:write')
  @RequireFeature('coupons')
  @Post('coupons')
  async createCoupon(
    @CurrentUser() admin: AuthenticatedUser,
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: CreateCouponDto,
  ) {
    return this.couponsService.createCoupon(tenant, admin, dto);
  }

  @RequirePermission('coupons:write')
  @Patch('coupons/:id')
  async updateCoupon(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCouponDto,
  ) {
    return this.couponsService.updateCoupon(tenant, admin, id, dto);
  }

  // ─── Configurable app settings ───────────────────────────────────────
  //
  // Allowlisted + validated in AppSettingService — this controller never
  // writes an arbitrary key. Setting keys are not UUIDs, so no
  // ParseUUIDPipe here; the service rejects any key outside its
  // definition list with a 400.

  @RequirePermission('settings:read')
  @Get('settings')
  async listSettings(@CurrentTenant() tenant: TenantContext) {
    return this.appSettingService.listConfigurable(tenant);
  }

  @RequirePermission('settings:write')
  @Patch('settings/:key')
  async updateSetting(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() admin: AuthenticatedUser,
    @Param('key') key: string,
    @Body() dto: UpdateSettingDto,
  ) {
    return this.appSettingService.updateConfigurable(
      tenant,
      admin,
      key,
      dto.value,
    );
  }
}
