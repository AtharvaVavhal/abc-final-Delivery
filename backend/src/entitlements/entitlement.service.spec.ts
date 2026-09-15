import { readFileSync } from 'fs';
import { join } from 'path';
import { SubscriptionStatus } from '@prisma/client';
import { EntitlementService } from './entitlement.service';
import {
  FEATURE_KEYS,
  LIMIT_KEYS,
} from '../platform/platform-plans/catalogue.constants';

/** Same convention as `platform.guard.spec.ts`/`tenant-data-access-guard
 * .spec.ts` — strip comments before a static source-text assertion so
 * legitimate prose mentions of the very thing being ruled out ("no cache",
 * "never reads Plan.isActive") don't self-trip the check. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/**
 * Phase 6 W2. Unit tests against a mocked `PrismaService`. `resolve()`
 * calls `scopedSubscriptionFindUnique`, which on a PrismaService uses
 * `getTenantScopedClient(this.prisma, tenantId)` / `$extends(...)` — mocked exactly the way
 * `app-setting.service.spec.ts` already establishes for
 * `resolvePrimaryStoreId`'s own use of the same D4 tenant-scoped client:
 * `$extends: jest.fn().mockReturnValue({ subscription: subscriptionDelegate })`,
 * ignoring the real scoping config (the scoping mechanism itself has no
 * dedicated spec file in this repo to defer to — it is exercised for real
 * in `test/e2e/entitlement-engine.e2e-spec.ts`, same split this file's own
 * header intends for `platform-plans.service.spec.ts` vs its e2e sibling).
 */
describe('EntitlementService', () => {
  const TENANT_ID = 'tenant-a';
  const ASSIGNED_PLAN_ID = 'plan-assigned';
  const FREE_PLAN_ID = 'free-plan-id';

  interface MockOpts {
    subscription?: { planId: string; status: SubscriptionStatus } | null;
    freePlan?: { id: string } | null;
    planFeatures?: Array<{ featureKey: string; enabled: boolean }>;
    planLimits?: Array<{ limitKey: string; limitValue: number | null }>;
    overrides?: Array<{
      featureKey: string | null;
      limitKey: string | null;
      boolValue: boolean | null;
      intValue: number | null;
    }>;
  }

  function makePrisma(opts: MockOpts = {}) {
    const subscriptionDelegate = {
      findUnique: jest.fn().mockResolvedValue(opts.subscription ?? null),
    };
    const planDelegate = {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          opts.freePlan === undefined ? { id: FREE_PLAN_ID } : opts.freePlan,
        ),
    };
    const planFeatureDelegate = {
      findMany: jest.fn().mockResolvedValue(opts.planFeatures ?? []),
    };
    const planLimitDelegate = {
      findMany: jest.fn().mockResolvedValue(opts.planLimits ?? []),
    };
    const overrideDelegate = {
      findMany: jest.fn().mockResolvedValue(opts.overrides ?? []),
    };
    const prisma = {
      plan: planDelegate,
      planFeature: planFeatureDelegate,
      planLimit: planLimitDelegate,
      tenantEntitlementOverride: overrideDelegate,
      $extends: jest
        .fn()
        .mockReturnValue({ subscription: subscriptionDelegate }),
    };
    return {
      prisma,
      subscriptionDelegate,
      planDelegate,
      planFeatureDelegate,
      planLimitDelegate,
      overrideDelegate,
    };
  }

  function allFeaturesDenied() {
    return Object.fromEntries(FEATURE_KEYS.map((k) => [k, false]));
  }

  function allLimitsDenied() {
    return Object.fromEntries(
      LIMIT_KEYS.map((k) => [
        k,
        {
          value: 0,
          period: k === 'orders_per_month' ? 'BILLING_PERIOD' : 'PERSISTENT',
        },
      ]),
    );
  }

  // ─── A/B/G: full-plan-granting statuses use the ASSIGNED plan ──────────

  it.each([
    ['ACTIVE', SubscriptionStatus.ACTIVE],
    ['TRIALING', SubscriptionStatus.TRIALING],
    ['PAST_DUE', SubscriptionStatus.PAST_DUE],
  ])(
    "%s subscription resolves the assigned plan's entitlements, not the free plan",
    async (_label, status) => {
      const { prisma, planFeatureDelegate, planLimitDelegate } = makePrisma({
        subscription: { planId: ASSIGNED_PLAN_ID, status },
        planFeatures: [{ featureKey: 'coupons', enabled: true }],
        planLimits: [{ limitKey: 'products', limitValue: 100 }],
      });
      const service = new EntitlementService(prisma as never);

      const result = await service.resolve(TENANT_ID);

      expect(planFeatureDelegate.findMany).toHaveBeenCalledWith({
        where: { planId: ASSIGNED_PLAN_ID },
      });
      expect(planLimitDelegate.findMany).toHaveBeenCalledWith({
        where: { planId: ASSIGNED_PLAN_ID },
      });
      expect(result.features.coupons).toBe(true);
      expect(result.limits.products).toEqual({
        value: 100,
        period: 'PERSISTENT',
      });
    },
  );

  // ─── C/D/E/F: fallback-to-free statuses ─────────────────────────────────

  it.each([
    ['PENDING', SubscriptionStatus.PENDING],
    ['PAUSED', SubscriptionStatus.PAUSED],
    ['CANCELLED', SubscriptionStatus.CANCELLED],
    ['EXPIRED', SubscriptionStatus.EXPIRED],
  ])(
    "%s subscription falls back to the free plan's entitlements, never the assigned plan",
    async (_label, status) => {
      const { prisma, planFeatureDelegate } = makePrisma({
        subscription: { planId: ASSIGNED_PLAN_ID, status },
        freePlan: { id: FREE_PLAN_ID },
      });
      const service = new EntitlementService(prisma as never);

      await service.resolve(TENANT_ID);

      expect(planFeatureDelegate.findMany).toHaveBeenCalledWith({
        where: { planId: FREE_PLAN_ID },
      });
      expect(planFeatureDelegate.findMany).not.toHaveBeenCalledWith({
        where: { planId: ASSIGNED_PLAN_ID },
      });
    },
  );

  // ─── H/I: feature and limit resolution ──────────────────────────────────

  it('resolves every catalogue feature key, true where PlanFeature.enabled=true, false elsewhere', async () => {
    const { prisma } = makePrisma({
      subscription: {
        planId: ASSIGNED_PLAN_ID,
        status: SubscriptionStatus.ACTIVE,
      },
      planFeatures: [
        { featureKey: 'coupons', enabled: true },
        { featureKey: 'api_access', enabled: false },
      ],
    });
    const service = new EntitlementService(prisma as never);

    const result = await service.resolve(TENANT_ID);

    expect(Object.keys(result.features).sort()).toEqual(
      [...FEATURE_KEYS].sort(),
    );
    expect(result.features.coupons).toBe(true);
    expect(result.features.api_access).toBe(false);
    expect(result.features.custom_domain).toBe(false); // no row at all — still present, denied
  });

  it('resolves every catalogue limit key with its finite value and ratified period', async () => {
    const { prisma } = makePrisma({
      subscription: {
        planId: ASSIGNED_PLAN_ID,
        status: SubscriptionStatus.ACTIVE,
      },
      planLimits: [
        { limitKey: 'products', limitValue: 50 },
        { limitKey: 'orders_per_month', limitValue: 200 },
      ],
    });
    const service = new EntitlementService(prisma as never);

    const result = await service.resolve(TENANT_ID);

    expect(Object.keys(result.limits).sort()).toEqual([...LIMIT_KEYS].sort());
    expect(result.limits.products).toEqual({ value: 50, period: 'PERSISTENT' });
    expect(result.limits.orders_per_month).toEqual({
      value: 200,
      period: 'BILLING_PERIOD',
    });
  });

  // ─── J: unlimited (NULL) plan limit ──────────────────────────────────────

  it('a PlanLimit row with limitValue: null resolves to unlimited (value: null)', async () => {
    const { prisma } = makePrisma({
      subscription: {
        planId: ASSIGNED_PLAN_ID,
        status: SubscriptionStatus.ACTIVE,
      },
      planLimits: [{ limitKey: 'storage_mb', limitValue: null }],
    });
    const service = new EntitlementService(prisma as never);

    const result = await service.resolve(TENANT_ID);

    expect(result.limits.storage_mb).toEqual({
      value: null,
      period: 'PERSISTENT',
    });
  });

  // ─── K/L: missing catalogue rows — deny-by-default ──────────────────────

  it('a catalogue feature with no PlanFeature row denies by default (false), never silently enables', async () => {
    const { prisma } = makePrisma({
      subscription: {
        planId: ASSIGNED_PLAN_ID,
        status: SubscriptionStatus.ACTIVE,
      },
      planFeatures: [],
    });
    const service = new EntitlementService(prisma as never);

    const result = await service.resolve(TENANT_ID);

    expect(result.features).toEqual(allFeaturesDenied());
  });

  it('a catalogue limit with no PlanLimit row denies by default (value: 0, not unlimited)', async () => {
    const { prisma } = makePrisma({
      subscription: {
        planId: ASSIGNED_PLAN_ID,
        status: SubscriptionStatus.ACTIVE,
      },
      planLimits: [],
    });
    const service = new EntitlementService(prisma as never);

    const result = await service.resolve(TENANT_ID);

    expect(result.limits).toEqual(allLimitsDenied());
  });

  // P6-D2 — the ratified contract draws a hard line between "no PlanLimit
  // row" (deny, value: 0) and "a PlanLimit row exists with limitValue:
  // NULL" (explicit unlimited) — these must never be conflated. Both
  // states exercised side by side, on different keys of the SAME plan, in
  // one test, so a regression collapsing them together cannot pass by
  // accident.
  it('a missing PlanLimit row (denied, value: 0) and an explicit NULL PlanLimit row (unlimited, value: null) resolve to distinct, never-conflated values', async () => {
    const { prisma } = makePrisma({
      subscription: {
        planId: ASSIGNED_PLAN_ID,
        status: SubscriptionStatus.ACTIVE,
      },
      // `products` has NO row at all; `storage_mb` has a row whose
      // limitValue is explicitly NULL.
      planLimits: [{ limitKey: 'storage_mb', limitValue: null }],
    });
    const service = new EntitlementService(prisma as never);

    const result = await service.resolve(TENANT_ID);

    expect(result.limits.products).toEqual({ value: 0, period: 'PERSISTENT' });
    expect(result.limits.storage_mb).toEqual({
      value: null,
      period: 'PERSISTENT',
    });
    expect(result.limits.products.value).not.toBeNull();
    expect(result.limits.storage_mb.value).not.toBe(0);
  });

  it('a PlanFeature row for a key outside the current catalogue is silently ignored (defensive), never crashes and never leaks an extra key', async () => {
    const { prisma } = makePrisma({
      subscription: {
        planId: ASSIGNED_PLAN_ID,
        status: SubscriptionStatus.ACTIVE,
      },
      planFeatures: [{ featureKey: 'support_sessions', enabled: true }],
    });
    const service = new EntitlementService(prisma as never);

    const result = await service.resolve(TENANT_ID);

    expect(result.features).toEqual(allFeaturesDenied());
    expect(Object.keys(result.features)).not.toContain('support_sessions');
  });

  // ─── M/N/O/P: overrides ──────────────────────────────────────────────────

  it('an active feature override REPLACES the plan value (plan says false, override says true)', async () => {
    const { prisma } = makePrisma({
      subscription: {
        planId: ASSIGNED_PLAN_ID,
        status: SubscriptionStatus.ACTIVE,
      },
      planFeatures: [{ featureKey: 'coupons', enabled: false }],
      overrides: [
        {
          featureKey: 'coupons',
          limitKey: null,
          boolValue: true,
          intValue: null,
        },
      ],
    });
    const service = new EntitlementService(prisma as never);

    const result = await service.resolve(TENANT_ID);

    expect(result.features.coupons).toBe(true);
  });

  it('an active limit override REPLACES the plan value entirely (not additive)', async () => {
    const { prisma } = makePrisma({
      subscription: {
        planId: ASSIGNED_PLAN_ID,
        status: SubscriptionStatus.ACTIVE,
      },
      planLimits: [{ limitKey: 'products', limitValue: 100 }],
      overrides: [
        {
          featureKey: null,
          limitKey: 'products',
          boolValue: null,
          intValue: 500,
        },
      ],
    });
    const service = new EntitlementService(prisma as never);

    const result = await service.resolve(TENANT_ID);

    expect(result.limits.products).toEqual({
      value: 500,
      period: 'PERSISTENT',
    });
  });

  it('only queries NON-revoked overrides (revokedAt: null) — a revoked override is excluded at the query level', async () => {
    const { prisma, overrideDelegate } = makePrisma({
      subscription: {
        planId: ASSIGNED_PLAN_ID,
        status: SubscriptionStatus.ACTIVE,
      },
    });
    const service = new EntitlementService(prisma as never);

    await service.resolve(TENANT_ID);

    expect(overrideDelegate.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID, revokedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('a limit override with intValue: null resolves to unlimited', async () => {
    const { prisma } = makePrisma({
      subscription: {
        planId: ASSIGNED_PLAN_ID,
        status: SubscriptionStatus.ACTIVE,
      },
      planLimits: [{ limitKey: 'products', limitValue: 100 }],
      overrides: [
        {
          featureKey: null,
          limitKey: 'products',
          boolValue: null,
          intValue: null,
        },
      ],
    });
    const service = new EntitlementService(prisma as never);

    const result = await service.resolve(TENANT_ID);

    expect(result.limits.products).toEqual({
      value: null,
      period: 'PERSISTENT',
    });
  });

  it('when more than one active override exists for the same key (the schema permits this — no UNIQUE(tenantId, featureKey) constraint), the LATEST (by createdAt) deterministically wins', async () => {
    const { prisma, overrideDelegate } = makePrisma({
      subscription: {
        planId: ASSIGNED_PLAN_ID,
        status: SubscriptionStatus.ACTIVE,
      },
      planFeatures: [{ featureKey: 'coupons', enabled: false }],
    });
    // Fed in createdAt-ascending order — the order the real `orderBy:
    // {createdAt:'asc'}` query would return them in.
    overrideDelegate.findMany.mockResolvedValue([
      {
        featureKey: 'coupons',
        limitKey: null,
        boolValue: true,
        intValue: null,
      },
      {
        featureKey: 'coupons',
        limitKey: null,
        boolValue: false,
        intValue: null,
      },
    ]);
    const service = new EntitlementService(prisma as never);

    const result = await service.resolve(TENANT_ID);

    expect(result.features.coupons).toBe(false); // the second (later) override wins
  });

  it('an override for a key outside the current catalogue is silently ignored, never crashes', async () => {
    const { prisma } = makePrisma({
      subscription: {
        planId: ASSIGNED_PLAN_ID,
        status: SubscriptionStatus.ACTIVE,
      },
      overrides: [
        {
          featureKey: 'retired_key',
          limitKey: null,
          boolValue: true,
          intValue: null,
        },
      ],
    });
    const service = new EntitlementService(prisma as never);

    const result = await service.resolve(TENANT_ID);

    expect(result.features).toEqual(allFeaturesDenied());
  });

  // ─── Q: cross-tenant isolation ────────────────────────────────────────────

  it('resolves the Subscription through the tenant-scoped client (D4) keyed to the exact tenantId passed in — never a different or unscoped tenant', async () => {
    const { prisma, subscriptionDelegate } = makePrisma({
      subscription: {
        planId: ASSIGNED_PLAN_ID,
        status: SubscriptionStatus.ACTIVE,
      },
    });
    const service = new EntitlementService(prisma as never);

    await service.resolve(TENANT_ID);

    expect(subscriptionDelegate.findUnique).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID },
      select: { planId: true, status: true },
    });
  });

  it("resolves overrides filtered by the exact tenantId passed in — a different tenantId can never surface another tenant's override rows", async () => {
    const { prisma, overrideDelegate } = makePrisma({
      subscription: {
        planId: ASSIGNED_PLAN_ID,
        status: SubscriptionStatus.ACTIVE,
      },
    });
    const service = new EntitlementService(prisma as never);

    await service.resolve('a-completely-different-tenant');

    expect(overrideDelegate.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'a-completely-different-tenant', revokedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  });

  // ─── R: no subscription at all ────────────────────────────────────────────

  it('a tenant with no Subscription row at all falls back to the free plan', async () => {
    const { prisma, planFeatureDelegate } = makePrisma({
      subscription: null,
      freePlan: { id: FREE_PLAN_ID },
    });
    const service = new EntitlementService(prisma as never);

    await service.resolve(TENANT_ID);

    expect(planFeatureDelegate.findMany).toHaveBeenCalledWith({
      where: { planId: FREE_PLAN_ID },
    });
  });

  it('if even the canonical free plan is missing (deployment defect), resolve() still deterministically returns the fully deny-by-default shape rather than throwing', async () => {
    const { prisma } = makePrisma({ subscription: null, freePlan: null });
    const service = new EntitlementService(prisma as never);

    const result = await service.resolve(TENANT_ID);

    expect(result.features).toEqual(allFeaturesDenied());
    expect(result.limits).toEqual(allLimitsDenied());
  });

  // ─── S: deterministic output ──────────────────────────────────────────────

  it('resolving twice against identical, unchanged data returns deep-equal results', async () => {
    const { prisma } = makePrisma({
      subscription: {
        planId: ASSIGNED_PLAN_ID,
        status: SubscriptionStatus.ACTIVE,
      },
      planFeatures: [{ featureKey: 'coupons', enabled: true }],
      planLimits: [{ limitKey: 'products', limitValue: 10 }],
    });
    const service = new EntitlementService(prisma as never);

    const first = await service.resolve(TENANT_ID);
    const second = await service.resolve(TENANT_ID);

    expect(first).toEqual(second);
  });

  // ─── T: no cross-request mutable cache ────────────────────────────────────

  it('reflects freshly-changed underlying data on the very next call — proves no memoization/caching between calls', async () => {
    const { prisma, planFeatureDelegate } = makePrisma({
      subscription: {
        planId: ASSIGNED_PLAN_ID,
        status: SubscriptionStatus.ACTIVE,
      },
      planFeatures: [{ featureKey: 'coupons', enabled: false }],
    });
    const service = new EntitlementService(prisma as never);

    const first = await service.resolve(TENANT_ID);
    expect(first.features.coupons).toBe(false);

    // Simulate the plan's feature actually changing between two requests.
    planFeatureDelegate.findMany.mockResolvedValue([
      { featureKey: 'coupons', enabled: true },
    ]);
    const second = await service.resolve(TENANT_ID);
    expect(second.features.coupons).toBe(true);
  });

  it('the service source defines no cache field, no module-level mutable store, and never imports Redis/ioredis', () => {
    // Comments legitimately discuss "cache"/"caching" in prose (explaining
    // why there deliberately isn't one) — stripped first so this checks
    // actual code, the same `stripComments` convention `platform.guard
    // .spec.ts`/`tenant-data-access-guard.spec.ts` already establish.
    const source = stripComments(
      readFileSync(join(__dirname, 'entitlement.service.ts'), 'utf8'),
    );
    expect(source).not.toMatch(/redis/i);
    expect(source).not.toMatch(/\bcache\b/i);
    // No class field assignment other than the constructor-injected
    // `prisma` — a crude but effective guard against a hidden mutable
    // singleton being added later without updating this test.
    expect(source).not.toMatch(/private\s+\w+\s*:\s*Map</);
  });

  // ─── Plan.isActive is never consulted (W1 schema invariant) ────────────────

  it('never selects or reads Plan.isActive anywhere in resolution', async () => {
    const { prisma, planDelegate } = makePrisma({
      subscription: null,
      freePlan: { id: FREE_PLAN_ID },
    });
    const service = new EntitlementService(prisma as never);

    await service.resolve(TENANT_ID);

    expect(planDelegate.findUnique).toHaveBeenCalledWith({
      where: { key: 'free' },
      select: { id: true },
    });
    // Comments legitimately mention "Plan.isActive" in prose explaining why
    // it is deliberately never read — stripped first, same reasoning as
    // the cache-check test above.
    const source = stripComments(
      readFileSync(join(__dirname, 'entitlement.service.ts'), 'utf8'),
    );
    expect(source).not.toMatch(/isActive/);
  });
});
