import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { TenantStatus } from '@prisma/client';
import { StorefrontTenantResolver } from './storefront-tenant.resolver';
import {
  clearStorefrontRoutingCache,
  rememberStorefrontRouting,
} from './storefront-routing-cache';

/**
 * Storefront tenant/store lookup now runs inside ONE platform-RLS-bypass
 * transaction as a single SQL statement (domain + fallback tenant + status
 * + primary store). These tests prove the fail-closed cases and the
 * host-keyed routing cache without hitting a real database.
 */
describe('StorefrontTenantResolver', () => {
  const HOST = 'shop.example.test';

  function makePrisma(
    row:
      | {
          tenantId: string;
          storeId: string | null;
          status: string | null;
        }
      | null,
  ) {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(undefined),
      $queryRaw: jest.fn().mockResolvedValue(row ? [row] : []),
    };
    const prisma = {
      $transaction: jest.fn(async (cb: (inner: typeof tx) => unknown) =>
        cb(tx),
      ),
      $extends: jest.fn(),
    };
    return { prisma, tx };
  }

  afterEach(() => {
    clearStorefrontRoutingCache();
  });

  it('resolves tenant + primary store from a hostname in a single $transaction', async () => {
    const { prisma, tx } = makePrisma({
      tenantId: 'tenant-a',
      storeId: 'store-a',
      status: TenantStatus.ACTIVE,
    });
    const resolver = new StorefrontTenantResolver(prisma as never);

    await expect(resolver.resolveStorefront(HOST)).resolves.toEqual({
      tenantId: 'tenant-a',
      storeId: 'store-a',
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('resolveTenantId returns only the tenant id from the same lookup', async () => {
    const { prisma } = makePrisma({
      tenantId: 'tenant-b',
      storeId: 'store-b',
      status: TenantStatus.ACTIVE,
    });
    const resolver = new StorefrontTenantResolver(prisma as never);
    await expect(resolver.resolveTenantId('localhost')).resolves.toBe(
      'tenant-b',
    );
  });

  it('throws ConflictException when no tenant exists at all', async () => {
    const { prisma } = makePrisma(null);
    const resolver = new StorefrontTenantResolver(prisma as never);
    await expect(resolver.resolveTenantId(undefined)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('throws ForbiddenException for a SUSPENDED tenant — same rule as assertTenantActive', async () => {
    const { prisma } = makePrisma({
      tenantId: 'tenant-s',
      storeId: 'store-s',
      status: TenantStatus.SUSPENDED,
    });
    const resolver = new StorefrontTenantResolver(prisma as never);
    await expect(resolver.resolveTenantId('localhost')).rejects.toThrow(
      ForbiddenException,
    );
    await expect(resolver.resolveTenantId('localhost')).rejects.toThrow(
      'This store is currently unavailable',
    );
  });

  it('resolveStorefront throws NotFoundException when the tenant has no primary store', async () => {
    const { prisma } = makePrisma({
      tenantId: 'tenant-c',
      storeId: null,
      status: TenantStatus.ACTIVE,
    });
    const resolver = new StorefrontTenantResolver(prisma as never);
    await expect(resolver.resolveTenantId('localhost')).resolves.toBe(
      'tenant-c',
    );
    await expect(
      resolver.resolveStorefront('localhost'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('resolveActiveTenantId uses the already-resolved merchant context and skips lookup', async () => {
    const { prisma } = makePrisma(null);
    const resolver = new StorefrontTenantResolver(prisma as never);
    await expect(
      resolver.resolveActiveTenantId(
        {
          tenantId: 'merchant-tenant',
          source: 'membership-default',
          membership: { role: 'OWNER' },
        },
        HOST,
      ),
    ).resolves.toBe('merchant-tenant');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('reuses a cached routing entry without opening another transaction', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      rememberStorefrontRouting(HOST, {
        tenantId: 'cached-tenant',
        storeId: 'cached-store',
      });
      const { prisma } = makePrisma(null);
      const resolver = new StorefrontTenantResolver(prisma as never);
      await expect(resolver.resolveStorefront(HOST)).resolves.toEqual({
        tenantId: 'cached-tenant',
        storeId: 'cached-store',
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = previous;
      clearStorefrontRoutingCache();
    }
  });
});
