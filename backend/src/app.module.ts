import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import {
  CUSTOMER_THROTTLE_MESSAGE,
  THROTTLE_LIMITS,
  THROTTLE_TTL_MS,
} from './common/throttling/throttle.constants';
import configuration from './common/config/configuration';
import { validateEnv } from './common/config/env.validation';
import { PrismaModule } from './common/database/prisma.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { HealthModule } from './common/health/health.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PlatformGuard } from './common/guards/platform.guard';
import { SupportSessionContextGuard } from './common/tenant/support-session-context.guard';
import { TenantContextGuard } from './common/tenant/tenant-context.guard';
import { TenantLifecycleGuard } from './common/tenant/tenant-lifecycle.guard';
import { PermissionsGuard } from './auth/permissions/permissions.guard';
import { EntitlementGuard } from './entitlements/entitlement.guard';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

import { AdminModule } from './admin/admin.module';
import { AppSettingModule } from './app-setting/app-setting.module';
import { EntitlementModule } from './entitlements/entitlement.module';
import { InvoicesModule } from './invoices/invoices.module';
import { AuthModule } from './auth/auth.module';
import { CartModule } from './cart/cart.module';
import { CheckoutModule } from './checkout/checkout.module';
import { CouponsModule } from './coupons/coupons.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentAccountsModule } from './payments/payment-accounts/payment-accounts.module';
import { PaymentsModule } from './payments/payments.module';
import { PlatformModule } from './platform/platform.module';
import { PostalModule } from './postal/postal.module';
import { ProductsModule } from './products/products.module';
import { ReviewsModule } from './reviews/reviews.module';
import { SupportSessionModule } from './support-sessions/support-session.module';
import { TeamModule } from './team/team.module';
import { UploadsModule } from './uploads/uploads.module';
import { UsersModule } from './users/users.module';

/**
 * Root module. Wiring order below follows the corrected, acyclic module
 * dependency graph reported alongside this scaffold, extended for Phase 10's
 * Reviews half (PHASE-10-PROPOSAL.md §1.3 — a new top-level module sitting
 * after `orders`, not nested under `products/`; see reviews.module.ts's own
 * doc comment for why) and Coupons half (§2.3 — coupons is base-layer,
 * same tier as users/notifications/uploads, no cross-module import at
 * all; see coupons.module.ts's own doc comment for why) and Phase 5 W2/W3's
 * Platform Control Plane (audit + platform — base layer, same tier as
 * notifications/coupons; platform depends only on audit, nothing yet
 * depends on either):
 *   users, notifications, uploads, coupons, app-setting, audit, platform
 *     (base layer)
 *   -> products -> cart
 *   -> orders -> payments -> checkout (-> coupons)
 *   -> reviews (-> orders)
 *   -> admin (-> orders, products, users, reviews, coupons), auth
 *
 * `platform` (SUPER_ADMIN-only, /platform/*) and `admin` (tenant-scoped,
 * /admin/*) are the two physically separate control planes named by the
 * SaaS Master Plan §11 — neither module imports the other.
 *
 * JwtAuthGuard + ThrottlerGuard are global (§17/§23): every route is
 * protected and IP-throttled by default; routes opt out individually with
 * @Public().
 *
 * Phase 3 (decisions D6, P2-D9, G-13, G-20; docs/saas/DECISIONS.md) replaced
 * the legacy `RolesGuard`/`@Roles()` mechanism with guards registered in
 * this order — order matters, each depends on the previous having run:
 *   1. `SupportSessionContextGuard` (Phase 5 W6, decision P5-D8) — resolves
 *      `request.tenantContext` from a server-validated `SupportSession`
 *      (`X-Support-Session-Id` header, SUPER_ADMIN-only, re-validated live
 *      on every request: owner/not-revoked/not-expired). A no-op when no
 *      such header is present, or when the caller isn't currently a
 *      SUPER_ADMIN — the ordinary path below is entirely unaffected. Skips
 *      @Public() and @PlatformOnly() routes (a support session never
 *      grants /platform/* access).
 *   2. `TenantContextGuard` — resolves `request.tenantContext` (host/
 *      subdomain + `X-Active-Tenant` header, cross-validated against the
 *      caller's ACTIVE `TenantMembership` rows; D6). Skips @Public() and
 *      @PlatformOnly() routes, AND skips entirely whenever step 1 already
 *      resolved a context — a support-session-derived context is
 *      authoritative and is never second-guessed, overridden, or rejected
 *      by this step's own header logic.
 *   3. `TenantLifecycleGuard` (Phase 5 W4) — blocks the request when the
 *      context resolved above belongs to a SUSPENDED tenant (§11's
 *      lifecycle invariant), before any RBAC/business logic runs. Same
 *      @Public()/@PlatformOnly() skip as step 2; a no-op when step 1/2
 *      resolved no context (e.g. a storefront shopper — see
 *      tenant-lifecycle.guard.ts's own header for why that path is
 *      enforced elsewhere, not here). Applies identically regardless of
 *      whether the context came from step 1 or step 2 — SupportSession is
 *      never special-cased around this guard (a SUSPENDED tenant's
 *      SupportSession is blocked exactly like any other request).
 *   4. `PermissionsGuard` — checks `@RequirePermission(...)` against the
 *      resolved tenant context's membership role (G-13's ratified
 *      catalogue), OR, for a `source: 'support-session'` context, against
 *      that session's own `grantedPermissions` ceiling (P5-D8) — see that
 *      guard's own header comment. Deny-by-default; no context + a
 *      declared permission requirement = 403.
 *   5. `EntitlementGuard` (Phase 6 W4) — checks `@RequireFeature(...)`
 *      against the tenant's effective plan entitlement, resolved through
 *      `EntitlementService.resolve()` (W2) — deny-by-default (403
 *      `upgrade_required`); a pure no-op for any route with no
 *      `@RequireFeature(...)` metadata, so this addition changes nothing
 *      about any existing route's authorization behavior. Runs strictly
 *      AFTER `PermissionsGuard`, so a permission failure is always thrown
 *      before this guard ever executes — the two layers compose, neither
 *      replaces the other.
 *
 * PlatformGuard (Phase 2a; decision P2-D1/G-11) remains global, independent
 * of all four above (frozen SaaS invariant 4) — it only acts on
 * @PlatformOnly() routes. `PlatformController` (Phase 5 W3) and
 * `SupportSessionController` (Phase 5 W6) are its consumers: steps 1-3 skip
 * them, `PermissionsGuard` passes them through (no `@RequirePermission()`
 * is ever declared there), and PlatformGuard alone enforces
 * platformRole === SUPER_ADMIN — so a SUPER_ADMIN can always inspect/resume
 * a SUSPENDED tenant, or create/list/revoke a SupportSession, via
 * /platform/*, unaffected by step 3, and unaffected by whether they
 * currently hold an active support session of their own (steps 1-3 never
 * touch a @PlatformOnly() route in either direction).
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
    }),
    // Per-route budgets: auth is stricter than the old global 20/60s;
    // public catalog reads and checkout are raised via @Throttle on those
    // controllers (see common/throttling/). skipIf disables throttling
    // only under NODE_ENV=test (test/e2e/support/env.setup.ts) — every e2e
    // request originates from the same loopback address, so without this
    // the shared IP limit trips well before it's the thing actually under
    // test (§27).
    ThrottlerModule.forRoot({
      errorMessage: CUSTOMER_THROTTLE_MESSAGE,
      throttlers: [{ ttl: THROTTLE_TTL_MS, limit: THROTTLE_LIMITS.default }],
      skipIf: () => process.env.NODE_ENV === 'test',
    }),
    // Registered exactly once, app-wide. The ScheduleExplorer it installs
    // discovers every @Cron/@Interval provider across all feature modules
    // (payments reconciliation, notifications outbox, webhook retry) — a
    // second forRoot() in a feature module registers the explorer twice and
    // runs every job twice (see the double "ScheduleModule initialized" /
    // reconciliation-ran-twice symptom).
    ScheduleModule.forRoot(),
    PrismaModule,
    HealthModule,
    UsersModule,
    NotificationsModule,
    UploadsModule,
    CouponsModule,
    AppSettingModule,
    PlatformModule,
    EntitlementModule,
    InvoicesModule,
    ProductsModule,
    CartModule,
    OrdersModule,
    PaymentsModule,
    PaymentAccountsModule,
    CheckoutModule,
    PostalModule,
    ReviewsModule,
    AdminModule,
    AuthModule,
    SupportSessionModule,
    TeamModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: SupportSessionContextGuard },
    { provide: APP_GUARD, useClass: TenantContextGuard },
    { provide: APP_GUARD, useClass: TenantLifecycleGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: EntitlementGuard },
    { provide: APP_GUARD, useClass: PlatformGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
