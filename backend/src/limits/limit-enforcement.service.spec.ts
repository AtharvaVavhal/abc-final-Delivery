import { ForbiddenException } from '@nestjs/common';
import {
  BillingPeriodUnresolvedError,
  LimitEnforcementService,
} from './limit-enforcement.service';
import { PERSISTENT_PERIOD } from '../usage/usage-period';

/**
 * Phase 6 W5. Unit tests against mocked `EntitlementService`/`UsageService`
 * — proves `LimitEnforcementService`'s own composition logic (which values
 * it passes to `UsageService.reserve`, how it maps a denied reservation to
 * a 403, the `BILLING_PERIOD` defensive rail). Real resource-boundary
 * behavior (Product/TeamMembership creation actually gated, rollback,
 * concurrency) is proven against real Postgres in
 * `test/e2e/limit-enforcement.e2e-spec.ts`.
 */
describe('LimitEnforcementService', () => {
  const TENANT_ID = 'tenant-a';

  function makeResolution(
    limitOverrides: Record<
      string,
      { value: number | null; period: 'PERSISTENT' | 'BILLING_PERIOD' }
    >,
  ) {
    const limits = {
      products: { value: 0, period: 'PERSISTENT' as const },
      team_members: { value: 0, period: 'PERSISTENT' as const },
      orders_per_month: { value: 0, period: 'BILLING_PERIOD' as const },
      storage_mb: { value: 0, period: 'PERSISTENT' as const },
      custom_domains: { value: 0, period: 'PERSISTENT' as const },
      ...limitOverrides,
    };
    return { features: {}, limits };
  }

  function makeServices(opts: {
    limits: Record<
      string,
      { value: number | null; period: 'PERSISTENT' | 'BILLING_PERIOD' }
    >;
    reserveOutcome?:
      | { status: 'RESERVED'; count: number }
      | { status: 'LIMIT_EXCEEDED'; count: number; limit: number };
  }) {
    const entitlementService = {
      resolve: jest.fn().mockResolvedValue(makeResolution(opts.limits)),
    };
    const usageService = {
      reserve: jest
        .fn()
        .mockResolvedValue(
          opts.reserveOutcome ?? { status: 'RESERVED', count: 1 },
        ),
      decrement: jest.fn().mockResolvedValue({ count: 0 }),
    };
    const service = new LimitEnforcementService(
      entitlementService as never,
      usageService as never,
    );
    return { service, entitlementService, usageService };
  }

  const tx = {} as never;

  // ─── A/B: under and at limit ────────────────────────────────────────────

  it('A. a finite limit with room remaining succeeds', async () => {
    const { service, usageService } = makeServices({
      limits: { products: { value: 10, period: 'PERSISTENT' } },
      reserveOutcome: { status: 'RESERVED', count: 5 },
    });

    await expect(
      service.assertLimit(tx, TENANT_ID, 'products', 1),
    ).resolves.toBeUndefined();
    expect(usageService.reserve).toHaveBeenCalledWith(
      tx,
      TENANT_ID,
      'products',
      PERSISTENT_PERIOD,
      1,
      10,
    );
  });

  it('B. a reservation landing exactly on the limit succeeds', async () => {
    const { service } = makeServices({
      limits: { products: { value: 10, period: 'PERSISTENT' } },
      reserveOutcome: { status: 'RESERVED', count: 10 },
    });

    await expect(
      service.assertLimit(tx, TENANT_ID, 'products', 1),
    ).resolves.toBeUndefined();
  });

  // ─── C: exhausted limit ──────────────────────────────────────────────────

  it('C. an exhausted finite limit throws ForbiddenException("limit_exceeded")', async () => {
    const { service } = makeServices({
      limits: { products: { value: 10, period: 'PERSISTENT' } },
      reserveOutcome: { status: 'LIMIT_EXCEEDED', count: 10, limit: 10 },
    });

    const rejection = service.assertLimit(tx, TENANT_ID, 'products', 1);
    await expect(rejection).rejects.toThrow(ForbiddenException);
    await expect(rejection).rejects.toThrow('limit_exceeded');
  });

  // ─── D: missing PlanLimit → denied ───────────────────────────────────────

  it('D. a missing PlanLimit (entitlement already resolved to value: 0, per P6-D2) denies any positive amount', async () => {
    const { service, usageService } = makeServices({
      limits: { products: { value: 0, period: 'PERSISTENT' } },
      reserveOutcome: { status: 'LIMIT_EXCEEDED', count: 0, limit: 0 },
    });

    await expect(
      service.assertLimit(tx, TENANT_ID, 'products', 1),
    ).rejects.toThrow('limit_exceeded');
    // No special-casing exists for "missing" — the same reserve() call is
    // made with whatever value EntitlementService resolved (0 here).
    expect(usageService.reserve).toHaveBeenCalledWith(
      tx,
      TENANT_ID,
      'products',
      PERSISTENT_PERIOD,
      1,
      0,
    );
  });

  // ─── E: unlimited ────────────────────────────────────────────────────────

  it('E. an unlimited PlanLimit (value: null) succeeds and still passes null through to UsageService (still tracked, per P6-D3)', async () => {
    const { service, usageService } = makeServices({
      limits: { products: { value: null, period: 'PERSISTENT' } },
      reserveOutcome: { status: 'RESERVED', count: 500 },
    });

    await expect(
      service.assertLimit(tx, TENANT_ID, 'products', 1),
    ).resolves.toBeUndefined();
    expect(usageService.reserve).toHaveBeenCalledWith(
      tx,
      TENANT_ID,
      'products',
      PERSISTENT_PERIOD,
      1,
      null,
    );
  });

  // ─── H: tenant isolation (unit-level: correct tenantId propagated) ──────

  it('H. resolves entitlements and reserves usage using the exact tenantId supplied — never a different one', async () => {
    const { service, entitlementService, usageService } = makeServices({
      limits: { products: { value: 10, period: 'PERSISTENT' } },
    });

    await service.assertLimit(tx, 'a-specific-tenant', 'products', 1);

    expect(entitlementService.resolve).toHaveBeenCalledWith(
      'a-specific-tenant',
      tx,
    );
    expect(usageService.reserve).toHaveBeenCalledWith(
      tx,
      'a-specific-tenant',
      'products',
      PERSISTENT_PERIOD,
      1,
      10,
    );
  });

  // ─── M: orders_per_month (BILLING_PERIOD) deferred ──────────────────────

  it('M. a BILLING_PERIOD-classified limit key (orders_per_month) throws BillingPeriodUnresolvedError, never silently invents a period', async () => {
    const { service, usageService } = makeServices({
      limits: { orders_per_month: { value: 100, period: 'BILLING_PERIOD' } },
    });

    const rejection = service.assertLimit(tx, TENANT_ID, 'orders_per_month', 1);
    await expect(rejection).rejects.toThrow(BillingPeriodUnresolvedError);
    // Distinct from the normal 403 path — never confused with a real denial.
    await expect(rejection).rejects.not.toBeInstanceOf(ForbiddenException);
    expect(usageService.reserve).not.toHaveBeenCalled();
  });

  // ─── N/O: orders_per_month (BILLING_PERIOD) — Phase 7 Wave B ────────────

  it('N. a BILLING_PERIOD-classified limit key WITH a caller-supplied period reserves against exactly that period, never PERSISTENT_PERIOD', async () => {
    const { service, usageService } = makeServices({
      limits: { orders_per_month: { value: 100, period: 'BILLING_PERIOD' } },
    });
    const period = '2026-02-01T00:00:00.000Z';

    await expect(
      service.assertLimit(tx, TENANT_ID, 'orders_per_month', 1, period),
    ).resolves.toBeUndefined();
    expect(usageService.reserve).toHaveBeenCalledWith(
      tx,
      TENANT_ID,
      'orders_per_month',
      period,
      1,
      100,
    );
  });

  it('N2. a BILLING_PERIOD-classified limit key WITH a period still enforces LIMIT_EXCEEDED normally', async () => {
    const { service } = makeServices({
      limits: { orders_per_month: { value: 100, period: 'BILLING_PERIOD' } },
      reserveOutcome: { status: 'LIMIT_EXCEEDED', count: 100, limit: 100 },
    });

    const rejection = service.assertLimit(
      tx,
      TENANT_ID,
      'orders_per_month',
      1,
      '2026-02-01T00:00:00.000Z',
    );
    await expect(rejection).rejects.toThrow(ForbiddenException);
    await expect(rejection).rejects.toThrow('limit_exceeded');
  });

  it('O. a caller-supplied period is IGNORED for a PERSISTENT-classified key — PERSISTENT_PERIOD is always used', async () => {
    const { service, usageService } = makeServices({
      limits: { products: { value: 10, period: 'PERSISTENT' } },
    });

    await service.assertLimit(
      tx,
      TENANT_ID,
      'products',
      1,
      '2026-02-01T00:00:00.000Z', // deliberately supplied, must be ignored
    );

    expect(usageService.reserve).toHaveBeenCalledWith(
      tx,
      TENANT_ID,
      'products',
      PERSISTENT_PERIOD,
      1,
      10,
    );
  });

  // ─── Q: no duplicate reservation ─────────────────────────────────────────

  it('Q. reserve() is called exactly once per assertLimit call — no duplicate or retry reservation', async () => {
    const { service, usageService } = makeServices({
      limits: { products: { value: 10, period: 'PERSISTENT' } },
    });

    await service.assertLimit(tx, TENANT_ID, 'products', 1);

    expect(usageService.reserve).toHaveBeenCalledTimes(1);
  });

  // ─── releaseLimit (decrement pass-through) ──────────────────────────────

  it('releaseLimit delegates directly to UsageService.decrement with the PERSISTENT period, no entitlement resolution', async () => {
    const { service, entitlementService, usageService } = makeServices({
      limits: { team_members: { value: 5, period: 'PERSISTENT' } },
    });

    await service.releaseLimit(tx, TENANT_ID, 'team_members', 1);

    expect(usageService.decrement).toHaveBeenCalledWith(
      tx,
      TENANT_ID,
      'team_members',
      PERSISTENT_PERIOD,
      1,
    );
    expect(entitlementService.resolve).not.toHaveBeenCalled();
  });

  // ─── P: error semantics — never leaks internals ─────────────────────────

  it('P. the limit_exceeded error never includes the tenant id, limit key, count, or configured limit in its message', async () => {
    const { service } = makeServices({
      limits: { products: { value: 10, period: 'PERSISTENT' } },
      reserveOutcome: { status: 'LIMIT_EXCEEDED', count: 10, limit: 10 },
    });

    try {
      await service.assertLimit(tx, TENANT_ID, 'products', 1);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as Error).message).toBe('limit_exceeded');
      expect((err as Error).message).not.toMatch(TENANT_ID);
      expect((err as Error).message).not.toMatch(/products|10/);
    }
  });
});
