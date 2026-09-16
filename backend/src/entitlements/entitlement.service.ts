import { Injectable } from '@nestjs/common';
import {
  Prisma,
  SubscriptionStatus,
  TenantEntitlementOverride,
} from '@prisma/client';
import { PrismaService } from '../common/database/prisma.service';
import { scopedSubscriptionFindUnique } from '../common/tenant/tenant-prisma';
import {
  FEATURE_KEYS,
  isFeatureKey,
  isLimitKey,
  LIMIT_KEY_PERIODS,
  LIMIT_KEYS,
} from '../platform/platform-plans/catalogue.constants';
import {
  EntitlementFeatures,
  EntitlementLimits,
  EntitlementResolution,
} from './entitlement.types';

/**
 * The existing canonical Free plan (SaaS Master Plan Phase 1 seed;
 * `prisma/seed-tenant-bootstrap.ts` / `prisma/backfill/dev-scratch-seed-
 * phase2b-equivalent.ts`, both `plan.upsert({ where: { key: 'free' }, ...
 * })`). `'free'` is the one and only fallback plan key this service ever
 * looks up — W2 does not create, seed, or configure a second Free plan.
 */
const FALLBACK_PLAN_KEY = 'free';

/**
 * Phase 6 W2 authorization §5 — ratified interim `Subscription.status` →
 * entitlement semantics. Every other status (`PENDING`, `PAUSED`,
 * `CANCELLED`, `EXPIRED`) resolves to the fallback/free plan instead.
 * `PAST_DUE` grants the full assigned plan for Phase 6 ONLY — a Phase 7
 * billing/grace-period dependency the authorization explicitly forbids W2
 * from implementing; this set is exactly the interim rule, nothing more.
 */
const FULL_PLAN_STATUSES: ReadonlySet<SubscriptionStatus> = new Set([
  SubscriptionStatus.TRIALING,
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.PAST_DUE,
]);

/**
 * Phase 6 W2 — the entitlement engine (`Plan -> PlanFeature/PlanLimit ->
 * Subscription -> EntitlementService.resolve(tenantId) -> {features,
 * limits}`). Backend-authoritative, read-only, request-scoped (no cache of
 * any kind — see the header comment on `resolve()` for why). Never mutates
 * `Subscription`, `Plan`, `PlanFeature`, `PlanLimit`, or
 * `TenantEntitlementOverride` — this whole file is read-only by
 * construction (no `.create`/`.update`/`.delete`/`.upsert` call exists
 * here). Owns none of: `Usage`, usage CAS, increment/decrement,
 * `@RequireFeature`/enforcement, tenant/platform entitlement HTTP APIs, or
 * anything Phase 7 (billing, webhooks, `SubscriptionEvent`, invoices,
 * payment methods) — all deferred to W3+ / Phase 7 per the W2
 * authorization's own scope boundary.
 *
 * **Tenant isolation.** `resolve()` takes a single `tenantId` and every
 * downstream read is scoped to exactly that value:
   *   - `Subscription` is read through `scopedSubscriptionFindUnique`
 *     (`tenant-prisma.ts`) rather than a raw `this.prisma.subscription...`
 *     call — the SAME reuse-not-reinvent convention that file's header
 *     establishes; `Subscription` is already one of its five scoped
 *     models. Standalone callers use `getTenantScopedClient`; callers
 *     already inside `$transaction` (W5 `assertLimit`) reuse that `tx`
 *     with SET LOCAL so FORCE RLS is satisfied without a nested
 *     interactive transaction. `EntitlementService` therefore never
 *     appears in `tenant-data-access-guard.spec.ts`'s allowlist.
 *   - `TenantEntitlementOverride` is read via an explicit
 *     `where: { tenantId }` using the CALLER-SUPPLIED `tenantId` — the
 *     same explicit-filter convention `orders.service.ts` (and every other
 *     Phase-4-scoped commerce table outside the D4 six-model set) already
 *     establishes for tenant-owned data outside `tenant-prisma.ts`'s scoped
 *     set. `TenantEntitlementOverride` is not in `tenant-data-access-guard
 *     .spec.ts`'s watched `TENANCY_MODELS` list (that list is the original
 *     six Phase 1/2a models only), so this file needs no allowlist entry
 *     for it either.
 *   - `Plan`/`PlanFeature`/`PlanLimit` are platform-level catalogue data,
 *     never tenant-owned (`tenant-prisma.ts`'s own header comment says so
 *     explicitly, and `platform-plans.service.ts` already reads them the
 *     same unscoped way) — read by an already-resolved, trusted `planId`
 *     (either the tenant's OWN `Subscription.planId`, itself just read
 *     through the scoped client above, or the fixed `'free'` catalogue
 *     key — never a client-supplied or cross-tenant value).
 *   - `resolve()` NEVER trusts a caller-supplied `tenantId` beyond taking
 *     it as its one parameter — this service has no HTTP surface at all
 *     (W2 explicitly forbids one); a future W6 controller is responsible
 *     for deriving `tenantId` from `@CurrentTenant()`'s server-resolved
 *     `TenantContext.tenantId`, the same way every other tenant-scoped
 *     service in this codebase already receives it, never from a raw
 *     route param or body field.
 *   - `EntitlementService.resolve()` deliberately does NOT re-check
 *     `Tenant.status` (ACTIVE/SUSPENDED) — that is `TenantLifecycleGuard`'s
 *     existing, separate, HTTP-pipeline-level responsibility (Phase 5 W4);
 *     duplicating it here would be exactly the "parallel tenant-resolution
 *     mechanism" the W2 authorization forbids inventing.
 */
@Injectable()
export class EntitlementService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Request-scoped by construction: every call re-reads `Subscription`,
   * `Plan`, `PlanFeature`, `PlanLimit`, and `TenantEntitlementOverride`
   * fresh from the database — there is no cache field on this class, no
   * module-level mutable state, and no cross-request memoization anywhere
   * in this file. A later phase may add caching under its own explicit
   * ACR; W2 deliberately does not, per its own authorization §11
   * ("correctness > caching").
   */
  async resolve(
    tenantId: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<EntitlementResolution> {
    const planId = await this.resolveEffectivePlanId(tenantId, client);

    const [features, limits] = await Promise.all([
      this.resolvePlanFeatures(planId),
      this.resolvePlanLimits(planId),
    ]);

    // Ordered oldest-first so that, in the DB-permitted-but-unexpected case
    // of more than one active override for the same key (see this class's
    // own header + the W2 report §16/§22 — the schema has no
    // UNIQUE(tenantId, featureKey)/UNIQUE(tenantId, limitKey) constraint),
    // the loop below applies them in creation order and the LATEST one
    // deterministically wins — matching "revoke-and-recreate" semantics'
    // intent (the newest override reflects current state) without
    // inventing a new schema constraint to rule the (already possible)
    // duplicate case out.
    const overrides = await this.prisma.tenantEntitlementOverride.findMany({
      where: { tenantId, revokedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    this.applyOverrides(features, limits, overrides);

    return { features, limits };
  }

  /**
   * Resolves which `Plan.id` this tenant's entitlements come from, per the
   * ratified interim status semantics (W2 authorization §5). Never reads
   * or reasons about `Plan.isActive` (schema.prisma's own Phase 6 W1
   * comment: "W2 must not read `Plan.isActive`" — an archived plan's
   * entitlements remain fully resolvable for any `Subscription` still
   * pointing to it; `isActive` gates only "selectable for a NEW
   * subscription", a W1 platform-CRUD concern).
   *
   * Returns `null` when no real Plan can be resolved at all (no
   * `Subscription` row AND the canonical `'free'` Plan itself is missing —
   * a deployment-configuration defect, not a normal per-tenant state; see
   * `resolvePlanFeatures`/`resolvePlanLimits` for how `null` deterministically
   * yields the fully deny-by-default resolution rather than throwing).
   */
  private async resolveEffectivePlanId(
    tenantId: string,
    client: PrismaService | Prisma.TransactionClient,
  ): Promise<string | null> {
    const subscription = await scopedSubscriptionFindUnique(client, tenantId);

    if (subscription && FULL_PLAN_STATUSES.has(subscription.status)) {
      return subscription.planId;
    }

    // No subscription at all, OR a status the ratified interim rule maps
    // to fallback/free (PENDING, PAUSED, CANCELLED, EXPIRED) — never the
    // subscription's own assigned planId in this branch.
    const freePlan = await this.prisma.plan.findUnique({
      where: { key: FALLBACK_PLAN_KEY },
      select: { id: true },
    });
    return freePlan?.id ?? null;
  }

  private async resolvePlanFeatures(
    planId: string | null,
  ): Promise<EntitlementFeatures> {
    const features = this.denyByDefaultFeatures();
    if (planId === null) {
      return features;
    }
    const rows = await this.prisma.planFeature.findMany({ where: { planId } });
    for (const row of rows) {
      // Defensive: a row could in principle carry a featureKey outside the
      // current code-defined catalogue (e.g. a key retired after this row
      // was written) — silently ignored rather than surfaced as an
      // unexpected object key, since `EntitlementFeatures` is a closed
      // Record<FeatureKey, boolean> with no room for one.
      if (isFeatureKey(row.featureKey)) {
        features[row.featureKey] = row.enabled;
      }
    }
    return features;
  }

  private async resolvePlanLimits(
    planId: string | null,
  ): Promise<EntitlementLimits> {
    const limits = this.denyByDefaultLimits();
    if (planId === null) {
      return limits;
    }
    const rows = await this.prisma.planLimit.findMany({ where: { planId } });
    for (const row of rows) {
      if (isLimitKey(row.limitKey)) {
        limits[row.limitKey] = {
          value: row.limitValue,
          // Re-derived from the ratified catalogue rather than trusting
          // the stored `row.period` — `PlanLimit.period` is always
          // server-derived from `LIMIT_KEY_PERIODS` at write time
          // (`platform-plans.service.ts#setPlanLimit`), so this is
          // normally identical; deriving it again here means a limit's
          // period classification can never drift at read time either,
          // even from a row written outside the normal write path.
          period: LIMIT_KEY_PERIODS[row.limitKey],
        };
      }
    }
    return limits;
  }

  /** Deny-by-default (W2 authorization §7/§8): every catalogue feature
   * missing a `PlanFeature` row resolves to `false`, never silently
   * enabled. */
  private denyByDefaultFeatures(): EntitlementFeatures {
    const features = {} as EntitlementFeatures;
    for (const key of FEATURE_KEYS) {
      features[key] = false;
    }
    return features;
  }

  /** Deny-by-default for limits: `value: 0` (zero allowance), not `null`
   * (unlimited) — `null` is the OPPOSITE of deny. Chosen for symmetry with
   * the feature default above and this codebase's "fail closed everywhere"
   * invariant; flagged explicitly in the W2 report §16/§22 as an
   * implementation-level reading of "deny-by-default / no-entitlement
   * semantics" rather than a literally-pinned-elsewhere numeric value. The
   * `period` is still the real, catalogue-defined value even when denied —
   * that classification is a property of the KEY, not of whether a
   * `PlanLimit` row happens to exist for this plan. */
  private denyByDefaultLimits(): EntitlementLimits {
    const limits = {} as EntitlementLimits;
    for (const key of LIMIT_KEYS) {
      limits[key] = { value: 0, period: LIMIT_KEY_PERIODS[key] };
    }
    return limits;
  }

  /**
   * Override semantics (W2 authorization §12, exactly): REPLACES the plan
   * value, never adds to it; feature overrides use `boolValue`, limit
   * overrides use `intValue` (`null` = unlimited); only active
   * (`revokedAt: null`) overrides participate; no `expiresAt`, no
   * automatic expiry (none exists on the model — W1 schema). The DB CHECK
   * `(featureKey IS NOT NULL) <> (limitKey IS NOT NULL)` guarantees every
   * row is exactly one kind; this method still branches on which is set
   * rather than assuming, matching the same defense-in-depth
   * `platform-plans.service.ts#createOverride` already applies.
   */
  private applyOverrides(
    features: EntitlementFeatures,
    limits: EntitlementLimits,
    overrides: TenantEntitlementOverride[],
  ): void {
    for (const override of overrides) {
      if (override.featureKey !== null) {
        if (isFeatureKey(override.featureKey) && override.boolValue !== null) {
          features[override.featureKey] = override.boolValue;
        }
        continue;
      }
      if (override.limitKey !== null && isLimitKey(override.limitKey)) {
        limits[override.limitKey] = {
          value: override.intValue,
          period: LIMIT_KEY_PERIODS[override.limitKey],
        };
      }
    }
  }
}
