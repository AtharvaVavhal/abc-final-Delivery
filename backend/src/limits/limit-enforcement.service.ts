import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/database/prisma.service';
import { EntitlementService } from '../entitlements/entitlement.service';
import { LimitKey } from '../platform/platform-plans/catalogue.constants';
import { PERSISTENT_PERIOD } from '../usage/usage-period';
import { UsageService } from '../usage/usage.service';

type LimitClient = PrismaService | Prisma.TransactionClient;

/** Same fixed, generic, machine-readable 403 signal convention W4's
 * `EntitlementGuard` already established for `upgrade_required` —
 * `HttpExceptionFilter`'s existing `extractMessage()` already surfaces a
 * string `HttpException` message verbatim, so no filter change is needed
 * here either. Never includes the limit key, tenant id, plan, current
 * count, or configured limit — nothing beyond this fixed string reaches
 * the client. */
const LIMIT_EXCEEDED_MESSAGE = 'limit_exceeded';

/**
 * Thrown by `assertLimit` when the resolved limit's period is
 * `BILLING_PERIOD` (today, only `orders_per_month`) AND the caller did not
 * supply a resolved `period` string — deliberately NOT a
 * `ForbiddenException`. This is a caller/wiring error, never a normal
 * per-request outcome, and must never be silently treated as an ordinary
 * limit-exceeded denial.
 *
 * Phase 7 — Wave B (orders_per_month enforcement): `CheckoutService` is
 * now a real caller for the `orders_per_month` key, but it only ever
 * calls `assertLimit` WITH a resolved `period` (derived from the
 * tenant's own provider-confirmed `Subscription.currentPeriodStart` —
 * see that call site's own comment) when one is actually available; when
 * no confirmed billing period exists yet, it skips calling `assertLimit`
 * for this key entirely rather than calling it without a period (see
 * `checkout.service.ts`'s own "fail safe, never invent a period"
 * comment). This error therefore still does not trigger via any current
 * call path — it remains a defensive rail against a FUTURE `BILLING_
 * PERIOD`-classified key (or caller) that forgets to resolve/supply its
 * own period before calling `assertLimit`.
 */
export class BillingPeriodUnresolvedError extends Error {
  constructor(limitKey: string) {
    super(
      `assertLimit: "${limitKey}" is BILLING_PERIOD-classified, and no authoritative billing-period identifier exists yet (P6-D3 — a recorded Phase 7 dependency). This key must not be enforced until that is resolved.`,
    );
    this.name = 'BillingPeriodUnresolvedError';
  }
}

/**
 * Phase 6 W5 — the limit-enforcement composition layer: `EntitlementService
 * .resolve()` (W2) for the effective limit + `UsageService.reserve()`/
 * `.decrement()` (W3) for the atomic CAS, composed exactly once here rather
 * than duplicated inside every resource service (`ProductsService`,
 * `TeamService`, and any future consumer all depend on this one class, not
 * on `EntitlementService`/`UsageService` directly for limit purposes).
 *
 * **The three-way limit distinction (P6-D2/P6-D3) needs NO special-casing
 * here** — `assertLimit` always calls `UsageService.reserve(tx, tenantId,
 * limitKey, <period>, amount, limit.value)` (`<period>` is
 * `PERSISTENT_PERIOD` for every `PERSISTENT`-classified key, unconditionally
 * — Phase 7 Wave B's own caller-supplied `period` parameter, below, is
 * read only for a `BILLING_PERIOD`-classified key) with whatever
 * `EntitlementService.resolve()` already resolved:
 *   - finite `PlanLimit` → `limit.value` is that finite integer → `reserve`
 *     enforces it via its own atomic CAS.
 *   - `PlanLimit` exists with `limitValue: NULL` → `limit.value` is
 *     `null` → `reserve`'s own unlimited branch always succeeds AND still
 *     tracks usage (P6-D3 Part A) — nothing extra needed here.
 *   - `PlanLimit` missing → `EntitlementService` already resolved this to
 *     `value: 0` (P6-D2) → `reserve`'s own CAS denies any positive
 *     `amount` against a `0` ceiling exactly like any other exhausted
 *     finite limit — no separate "missing" branch exists or is needed.
 *
 * **Transaction composition** — `tx` is the CALLER's own transaction
 * client (matching `UsageService`'s own `PrismaService |
 * Prisma.TransactionClient` convention exactly); this class never opens
 * `$transaction` itself. `EntitlementService.resolve(tenantId, tx)` is
 * passed that same client so the Subscription FORCE RLS GUC is set on
 * the caller's connection. Opening a nested `prisma.$transaction` from
 * inside `assertLimit` aborts the outer resource-creation transaction.
 */
@Injectable()
export class LimitEnforcementService {
  constructor(
    private readonly entitlementService: EntitlementService,
    private readonly usageService: UsageService,
  ) {}

  /**
   * Atomically reserves `amount` more usage against `limitKey`'s current
   * effective limit, inside the caller's own transaction `tx`. Throws
   * `ForbiddenException('limit_exceeded')` (never allow-on-error, never a
   * silent success) when the reservation is denied. The caller is
   * responsible for actually creating the gated resource using the SAME
   * `tx` immediately afterward, inside the SAME transaction — this method
   * does not (and cannot) create anything itself.
   *
   * Phase 7 — Wave B addition: `period` is REQUIRED for a
   * `BILLING_PERIOD`-classified `limitKey` (today, only
   * `orders_per_month`) — the caller (`CheckoutService`) is responsible
   * for resolving it from the tenant's own provider-confirmed
   * `Subscription.currentPeriodStart` (`deriveBillingPeriodIdentifier()`,
   * `usage-period.ts`) BEFORE calling this method; omitting it for a
   * `BILLING_PERIOD` key throws `BillingPeriodUnresolvedError` (unchanged
   * behavior). `period` is ALWAYS ignored for a `PERSISTENT`-classified
   * key — `PERSISTENT_PERIOD` is used unconditionally in that case,
   * exactly as before this wave, so no existing caller (`ProductsService`,
   * `TeamService`, `UploadsService`) is in any way affected by this new,
   * optional parameter.
   */
  async assertLimit(
    tx: LimitClient,
    tenantId: string,
    limitKey: LimitKey,
    amount: number,
    period?: string,
  ): Promise<void> {
    const resolution = await this.entitlementService.resolve(tenantId, tx);
    const limit = resolution.limits[limitKey];

    let resolvedPeriod: string;
    if (limit.period === 'BILLING_PERIOD') {
      if (!period) {
        throw new BillingPeriodUnresolvedError(limitKey);
      }
      resolvedPeriod = period;
    } else {
      resolvedPeriod = PERSISTENT_PERIOD;
    }

    const outcome = await this.usageService.reserve(
      tx,
      tenantId,
      limitKey,
      resolvedPeriod,
      amount,
      limit.value,
    );

    if (outcome.status === 'LIMIT_EXCEEDED') {
      throw new ForbiddenException(LIMIT_EXCEEDED_MESSAGE);
    }
  }

  /**
   * Thin pass-through to `UsageService.decrement` — exists so every
   * resource service depends on this ONE composed service for both
   * directions of limit-relevant usage change, rather than injecting
   * `UsageService` directly just for the decrement half (e.g.
   * `TeamService`'s member-suspension path). No entitlement resolution is
   * needed for a decrement (there is no limit to check when usage is
   * going DOWN), so this does not call `EntitlementService` at all.
   */
  async releaseLimit(
    tx: LimitClient,
    tenantId: string,
    limitKey: LimitKey,
    amount: number,
  ): Promise<void> {
    await this.usageService.decrement(
      tx,
      tenantId,
      limitKey,
      PERSISTENT_PERIOD,
      amount,
    );
  }
}
