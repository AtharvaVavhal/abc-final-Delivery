import { NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { TenantContext } from '../common/tenant/tenant-context';
import { ProductsService } from './products.service';

/**
 * Focused on reactivateProduct — the one method this phase adds. Same
 * direct-instantiation mocking pattern as orders.service.spec.ts. Full
 * CRUD-path coverage for the rest of ProductsService is exercised via
 * live curl testing against a real database, same as every other phase
 * this session.
 *
 * Phase 5 W8 update: every mutation below now runs inside
 * `prisma.$transaction` (so its `TenantAuditLog` write commits atomically
 * with it) — `buildService` mocks `$transaction` to invoke its callback
 * with a `tx` object built from the same model delegates, the same
 * mocking-shape convention `platform.service.spec.ts`/
 * `team.service.spec.ts` already established.
 */
const tenantContext: TenantContext = {
  tenantId: 'tenant-a',
  source: 'membership-default',
  membership: { role: 'OWNER' },
};

const actor: AuthenticatedUser = {
  id: 'user-1',
  email: 'owner@example.test',
  role: 'ADMIN',
  platformRole: null,
  memberships: [{ tenantId: 'tenant-a', role: 'OWNER' }],
};

function makeAudit() {
  return { logTenantAction: jest.fn().mockResolvedValue(undefined) };
}

describe('ProductsService.reactivateProduct', () => {
  function buildService(
    existingProduct: {
      id: string;
      isActive: boolean;
      tenantId?: string;
    } | null,
  ) {
    const productDelegate = {
      findUnique: jest.fn().mockResolvedValue(existingProduct),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: { isActive: boolean } }) =>
          Promise.resolve({ ...existingProduct, ...data }),
        ),
    };
    const tenantMembershipDelegate = {
      findUnique: jest.fn().mockResolvedValue({ id: 'membership-1' }),
    };
    const tx = {
      product: productDelegate,
      tenantMembership: tenantMembershipDelegate,
    };
    const prisma = {
      product: productDelegate,
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)),
    };
    const uploadsService = {};
    const audit = makeAudit();
    const service = new ProductsService(
      prisma as never,
      uploadsService as never,
      audit as never,
      {} as never,
    );
    return { service, prisma, audit };
  }

  it('sets isActive back to true for a deactivated product', async () => {
    const { service, prisma, audit } = buildService({
      id: 'prod-1',
      isActive: false,
      tenantId: 'tenant-a',
    });

    await service.reactivateProduct(tenantContext, actor, 'prod-1');

    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 'prod-1' },
      data: { isActive: true },
    });
    expect(audit.logTenantAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: 'tenant-a',
        action: 'product.reactivate',
        targetId: 'prod-1',
      }),
    );
  });

  it('is idempotent — reactivating an already-active product is a no-op success, not an error', async () => {
    const { service, prisma } = buildService({
      id: 'prod-1',
      isActive: true,
      tenantId: 'tenant-a',
    });

    await expect(
      service.reactivateProduct(tenantContext, actor, 'prod-1'),
    ).resolves.toBeUndefined();
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 'prod-1' },
      data: { isActive: true },
    });
  });

  it('404s for a product id that does not exist, same as deactivateProduct', async () => {
    const { service, prisma } = buildService(null);

    await expect(
      service.reactivateProduct(tenantContext, actor, 'missing'),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('W10 hardening (P0 regression) — 404s for a product belonging to a DIFFERENT tenant, never reactivating it', async () => {
    const { service, prisma } = buildService({
      id: 'prod-1',
      isActive: false,
      tenantId: 'tenant-b',
    });

    await expect(
      service.reactivateProduct(tenantContext, actor, 'prod-1'),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.product.update).not.toHaveBeenCalled();
  });
});

/**
 * Phase 13.2 — admin category activation. The public listCategories /
 * getCategoryTree stay isActive-filtered; these methods are the admin
 * management surface. RBAC + public-hiding is covered end-to-end in
 * test/e2e/admin-control-plane.e2e-spec.ts.
 */
describe('ProductsService — admin category management', () => {
  function buildService(
    existingCategory: {
      id: string;
      isActive: boolean;
      tenantId?: string;
    } | null,
    all: Array<{ id: string; isActive: boolean }> = [],
  ) {
    const categoryDelegate = {
      findUnique: jest.fn().mockResolvedValue(existingCategory),
      findMany: jest.fn().mockResolvedValue(all),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: { isActive: boolean } }) =>
          Promise.resolve({ ...existingCategory, ...data }),
        ),
    };
    const tenantMembershipDelegate = {
      findUnique: jest.fn().mockResolvedValue({ id: 'membership-1' }),
    };
    const tx = {
      category: categoryDelegate,
      tenantMembership: tenantMembershipDelegate,
    };
    const prisma = {
      category: categoryDelegate,
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)),
    };
    const audit = makeAudit();
    const service = new ProductsService(
      prisma as never,
      {} as never,
      audit as never,
      {} as never,
    );
    return { service, prisma, audit };
  }

  it('adminListCategories does NOT filter by isActive, but IS scoped to the caller tenant (W10 hardening)', async () => {
    const { service, prisma } = buildService(null, [
      { id: 'a', isActive: true },
      { id: 'b', isActive: false },
    ]);

    const result = await service.adminListCategories(tenantContext);

    expect(prisma.category.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a' },
      orderBy: { name: 'asc' },
    });
    expect(result).toHaveLength(2);
  });

  it('deactivateCategory sets isActive=false and audits it', async () => {
    const { service, prisma, audit } = buildService({
      id: 'cat-1',
      isActive: true,
      tenantId: 'tenant-a',
    });

    await service.deactivateCategory(tenantContext, actor, 'cat-1');

    expect(prisma.category.update).toHaveBeenCalledWith({
      where: { id: 'cat-1' },
      data: { isActive: false },
    });
    expect(audit.logTenantAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'category.deactivate' }),
    );
  });

  it('reactivateCategory sets isActive=true and is idempotent', async () => {
    const { service, prisma } = buildService({
      id: 'cat-1',
      isActive: true,
      tenantId: 'tenant-a',
    });

    await expect(
      service.reactivateCategory(tenantContext, actor, 'cat-1'),
    ).resolves.toMatchObject({ isActive: true });
    expect(prisma.category.update).toHaveBeenCalledWith({
      where: { id: 'cat-1' },
      data: { isActive: true },
    });
  });

  it('404s deactivating a category that does not exist', async () => {
    const { service, prisma } = buildService(null);

    await expect(
      service.deactivateCategory(tenantContext, actor, 'missing'),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.category.update).not.toHaveBeenCalled();
  });

  it('W10 hardening (P0 regression) — 404s deactivating a category belonging to a DIFFERENT tenant, never touching it', async () => {
    const { service, prisma } = buildService({
      id: 'cat-1',
      isActive: true,
      tenantId: 'tenant-b',
    });

    await expect(
      service.deactivateCategory(tenantContext, actor, 'cat-1'),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.category.update).not.toHaveBeenCalled();
  });
});

describe('ProductsService — admin product reads', () => {
  /** Captures the `where` the service builds so the isActive-filter
   * behaviour can be asserted without digging into `jest.Mock.mock.calls`
   * (typed `any`). End-to-end filtering is also covered in
   * test/e2e/admin-control-plane.e2e-spec.ts. */
  function buildService(product: Record<string, unknown> | null) {
    let listWhere: unknown;
    let getWhere: unknown;
    const prisma = {
      product: {
        findMany: jest.fn().mockImplementation((args: { where: unknown }) => {
          listWhere = args.where;
          return Promise.resolve(product ? [product] : []);
        }),
        count: jest.fn().mockResolvedValue(product ? 1 : 0),
        findUnique: jest.fn().mockImplementation((args: { where: unknown }) => {
          getWhere = args.where;
          return Promise.resolve(product);
        }),
      },
    };
    const uploads = { resolveUrl: () => 'https://example.test/img' };
    const service = new ProductsService(
      prisma as never,
      uploads as never,
      makeAudit() as never,
      {} as never,
    );
    return {
      service,
      getListWhere: () => listWhere,
      getGetWhere: () => getWhere,
    };
  }

  it('adminListProducts applies no isActive filter by default, but IS scoped to the caller tenant (W10 hardening)', async () => {
    const { service, getListWhere } = buildService({
      id: 'p1',
      isActive: true,
      images: [],
    });

    await service.adminListProducts(
      tenantContext,
      1,
      20,
      undefined,
      undefined,
      undefined,
    );

    expect(getListWhere()).toEqual({ tenantId: 'tenant-a' });
  });

  it('adminListProducts narrows to inactive when status=inactive', async () => {
    const { service, getListWhere } = buildService(null);

    await service.adminListProducts(
      tenantContext,
      1,
      20,
      undefined,
      undefined,
      'inactive',
    );

    expect(getListWhere()).toEqual({
      tenantId: 'tenant-a',
      isActive: false,
    });
  });

  it('adminGetProduct looks up by id only — not isActive-filtered', async () => {
    const { service, getGetWhere } = buildService({
      id: 'p1',
      isActive: false,
      tenantId: 'tenant-a',
      images: [],
    });

    await service.adminGetProduct(tenantContext, 'p1');

    expect(getGetWhere()).toEqual({ id: 'p1' });
  });

  it('adminGetProduct 404s when the product does not exist', async () => {
    const { service } = buildService(null);
    await expect(
      service.adminGetProduct(tenantContext, 'missing'),
    ).rejects.toThrow(NotFoundException);
  });

  it('W10 hardening (P0 regression) — adminGetProduct 404s for a product belonging to a DIFFERENT tenant', async () => {
    const { service } = buildService({
      id: 'p1',
      isActive: true,
      tenantId: 'tenant-b',
      images: [],
    });

    await expect(service.adminGetProduct(tenantContext, 'p1')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('ProductsService.createProduct — audit atomicity (Phase 5 W8)', () => {
  it('fails the whole operation (never a "product created, audit lost" split) when the audit write itself fails', async () => {
    const categoryDelegate = {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'cat-1', tenantId: 'tenant-a' }),
    };
    const productDelegate = {
      create: jest
        .fn()
        .mockResolvedValue({ id: 'prod-1', tenantId: 'tenant-a' }),
    };
    const tenantMembershipDelegate = {
      findUnique: jest.fn().mockResolvedValue({ id: 'membership-1' }),
    };
    const tx = {
      category: categoryDelegate,
      product: productDelegate,
      tenantMembership: tenantMembershipDelegate,
    };
    const prisma = {
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)),
    };
    const audit = {
      logTenantAction: jest
        .fn()
        .mockRejectedValueOnce(new Error('audit db down')),
    };
    const limitEnforcementService = {
      assertLimit: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ProductsService(
      prisma as never,
      {} as never,
      audit as never,
      limitEnforcementService as never,
    );

    await expect(
      service.createProduct(
        {
          tenantId: 'tenant-a',
          source: 'membership-default',
          membership: { role: 'OWNER' },
        },
        {
          id: 'user-1',
          email: 'owner@example.test',
          role: 'ADMIN',
          platformRole: null,
          memberships: [{ tenantId: 'tenant-a', role: 'OWNER' }],
        },
        {
          categoryId: 'cat-1',
          name: 'Test',
          slug: 'test',
          basePrice: 10,
          minQuantity: 1,
        },
      ),
    ).rejects.toThrow('audit db down');
    // The create call did happen — this is exactly why it MUST be inside
    // one transaction with the audit write; a real $transaction rolls
    // both back atomically because nothing here catches/swallows the
    // audit failure.
    expect(productDelegate.create).toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ timeout: 20_000, maxWait: 10_000 }),
    );
  });
});

describe('ProductsService.listProducts', () => {
  it('includes products from active child categories when filtering by a parent', async () => {
    const productDelegate = {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    };
    const prisma = {
      category: {
        findMany: jest.fn().mockResolvedValue([{ id: 'child-1' }]),
      },
      product: productDelegate,
    };
    const service = new ProductsService(
      prisma as never,
      {} as never,
      makeAudit() as never,
      {} as never,
    );

    await service.listProducts('tenant-a', 1, 20, 'parent-1', undefined);

    expect(prisma.category.findMany).toHaveBeenCalledWith({
      where: { parentCategoryId: 'parent-1', isActive: true, tenantId: 'tenant-a' },
      select: { id: true },
    });
    expect(productDelegate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-a',
          isActive: true,
          categoryId: { in: ['parent-1', 'child-1'] },
        }),
      }),
    );
  });
});
