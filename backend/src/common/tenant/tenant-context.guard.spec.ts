import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ACTIVE_TENANT_HEADER,
  TenantContextGuard,
} from './tenant-context.guard';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';
import { PrismaService } from '../database/prisma.service';

/**
 * TenantContextGuard — Phase 3 (decision D6, docs/saas/DECISIONS.md,
 * resolved 2026-09-07: BOTH host/subdomain + `X-Active-Tenant`, header
 * cross-validated against ACTIVE memberships; no client-supplied tenant id
 * trusted alone). Mirrors `platform.guard.spec.ts`'s ExecutionContext-mock
 * pattern; `storeDomain.findUnique` is stubbed rather than hitting a real
 * database (unit-level; the real query is exercised by the e2e suite).
 */
function makeContext(options: {
  isPublic?: boolean;
  isPlatformOnly?: boolean;
  user?: Partial<AuthenticatedUser>;
  headers?: Record<string, string>;
  hostname?: string;
}) {
  const reflector = {
    getAllAndOverride: jest
      .fn()
      .mockImplementation((key: string) =>
        key === 'isPublic' ? options.isPublic : options.isPlatformOnly,
      ),
  } as unknown as Reflector;

  const request: Record<string, unknown> = {
    user: options.user,
    headers: options.headers ?? {},
    hostname: options.hostname,
  };

  const context = {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  return { context, reflector, request };
}

describe('TenantContextGuard (Phase 3 / D6)', () => {
  it('uses the DB-validated OTP storefront without granting membership permissions', async () => {
    const { context, reflector, request } = makeContext({
      user: { memberships: [], storefront: { tenantId: 't1', storeId: 's1' } },
    });
    await new TenantContextGuard(reflector, {} as PrismaService).canActivate(
      context,
    );
    expect(request.tenantContext).toEqual({
      tenantId: 't1',
      source: 'storefront-otp',
    });
  });
  it('refuses a browser tenant override for an OTP storefront session', async () => {
    const { context, reflector } = makeContext({
      user: { memberships: [], storefront: { tenantId: 't1', storeId: 's1' } },
      headers: { [ACTIVE_TENANT_HEADER]: 't2' },
    });
    await expect(
      new TenantContextGuard(reflector, {} as PrismaService).canActivate(
        context,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  const prisma = {
    storeDomain: { findUnique: jest.fn().mockResolvedValue(null) },
  } as unknown as PrismaService;

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.storeDomain.findUnique as jest.Mock).mockResolvedValue(null);
  });

  it('skips @Public() routes entirely', async () => {
    const { context, reflector, request } = makeContext({ isPublic: true });
    const guard = new TenantContextGuard(reflector, prisma);
    expect(await guard.canActivate(context)).toBe(true);
    expect(request.tenantContext).toBeUndefined();
  });

  it('skips platform-only routes entirely (the @PlatformOnly decorator)', async () => {
    const { context, reflector, request } = makeContext({
      isPlatformOnly: true,
      user: { memberships: [{ tenantId: 't1', role: 'OWNER' }] },
    });
    const guard = new TenantContextGuard(reflector, prisma);
    expect(await guard.canActivate(context)).toBe(true);
    expect(request.tenantContext).toBeUndefined();
  });

  it('resolves the sole ACTIVE membership as a convenience default (no header)', async () => {
    const { context, reflector, request } = makeContext({
      user: { memberships: [{ tenantId: 't1', role: 'OWNER' }] },
    });
    const guard = new TenantContextGuard(reflector, prisma);
    expect(await guard.canActivate(context)).toBe(true);
    expect(request.tenantContext).toEqual({
      tenantId: 't1',
      source: 'membership-default',
      membership: { role: 'OWNER' },
    });
  });

  it('sets no context for a User with zero memberships and no header', async () => {
    const { context, reflector, request } = makeContext({
      user: { memberships: [] },
    });
    const guard = new TenantContextGuard(reflector, prisma);
    expect(await guard.canActivate(context)).toBe(true);
    expect(request.tenantContext).toBeUndefined();
  });

  it('sets no implicit context for a User with MULTIPLE memberships and no header (no guessing)', async () => {
    const { context, reflector, request } = makeContext({
      user: {
        memberships: [
          { tenantId: 't1', role: 'OWNER' },
          { tenantId: 't2', role: 'STAFF' },
        ],
      },
    });
    const guard = new TenantContextGuard(reflector, prisma);
    expect(await guard.canActivate(context)).toBe(true);
    expect(request.tenantContext).toBeUndefined();
  });

  it('X-Active-Tenant selects the matching membership, taking precedence over the default', async () => {
    const { context, reflector, request } = makeContext({
      user: {
        memberships: [
          { tenantId: 't1', role: 'OWNER' },
          { tenantId: 't2', role: 'STAFF' },
        ],
      },
      headers: { [ACTIVE_TENANT_HEADER]: 't2' },
    });
    const guard = new TenantContextGuard(reflector, prisma);
    expect(await guard.canActivate(context)).toBe(true);
    expect(request.tenantContext).toEqual({
      tenantId: 't2',
      source: 'membership-header',
      membership: { role: 'STAFF' },
    });
  });

  it('CONTEXT-SPOOF: X-Active-Tenant naming a tenant the caller has no membership in is rejected with 403, never a silent fallback', async () => {
    const { context, reflector, request } = makeContext({
      user: { memberships: [{ tenantId: 't1', role: 'OWNER' }] },
      headers: { [ACTIVE_TENANT_HEADER]: 't-not-mine' },
    });
    const guard = new TenantContextGuard(reflector, prisma);
    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
    expect(request.tenantContext).toBeUndefined();
  });

  it('no authenticated user: passes through (JwtAuthGuard already handles rejection for non-@Public() routes)', async () => {
    const { context, reflector, request } = makeContext({ user: undefined });
    const guard = new TenantContextGuard(reflector, prisma);
    expect(await guard.canActivate(context)).toBe(true);
    expect(request.tenantContext).toBeUndefined();
  });

  it('Phase 5 W6 (P5-D8): does not overwrite or reject a tenantContext already resolved by SupportSessionContextGuard, even with a mismatched X-Active-Tenant header present', async () => {
    const { context, reflector, request } = makeContext({
      user: { memberships: [] },
      headers: { [ACTIVE_TENANT_HEADER]: 'some-other-tenant' },
    });
    const preset = {
      tenantId: 'session-tenant',
      source: 'support-session' as const,
      supportSession: { id: 's1', grantedPermissions: ['orders:read'] },
    };
    request.tenantContext = preset;
    const guard = new TenantContextGuard(reflector, prisma);
    expect(await guard.canActivate(context)).toBe(true);
    expect(request.tenantContext).toBe(preset);
    /* eslint-disable @typescript-eslint/unbound-method */
    expect(prisma.storeDomain.findUnique).not.toHaveBeenCalled();
    /* eslint-enable @typescript-eslint/unbound-method */
  });
});
