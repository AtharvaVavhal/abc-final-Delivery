import { readFileSync } from 'fs';
import { join } from 'path';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { TenantStatus } from '@prisma/client';
import { AuditService } from '../common/audit/audit.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PlatformService } from './platform.service';

/**
 * Phase 5 W3. Unit tests against a mocked `PrismaService` whose
 * `$transaction` invokes the callback with a fake `tx` — the same
 * mocking shape convention as `audit.service.spec.ts`. Full HTTP-level
 * authorization (guard chain) and real-Postgres transactional rollback
 * are proven end-to-end in `test/e2e/platform-control-plane.e2e-spec.ts`;
 * this file proves `PlatformService`'s own logic in isolation.
 */
describe('PlatformService', () => {
  const actor: AuthenticatedUser = {
    id: 'super-admin-1',
    email: 'sa@example.test',
    role: 'ADMIN',
    platformRole: 'SUPER_ADMIN',
    memberships: [],
  };

  interface FixtureTenant {
    id: string;
    slug: string;
    status: TenantStatus;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: null;
  }

  const activeTenant: FixtureTenant = {
    id: 'tenant-a',
    slug: 'tenant-a',
    status: TenantStatus.ACTIVE,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
  };

  function makePrisma(
    tenantRow: FixtureTenant | null,
    postTransitionStatus: TenantStatus | undefined = tenantRow?.status,
  ) {
    const tx = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue(tenantRow),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        // Reflects the status AFTER a successful CAS update — a real
        // `findUniqueOrThrow` re-read would see the row this transaction
        // itself just wrote, not the pre-transition snapshot.
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          ...tenantRow,
          status: postTransitionStatus,
          stores: [],
          subscription: null,
        }),
      },
    };
    const prisma = {
      tenant: { findMany: jest.fn(), count: jest.fn() },
      platformAuditLog: { findMany: jest.fn(), count: jest.fn() },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)),
    };
    return { prisma, tx };
  }

  function makeAudit() {
    return { logPlatformAction: jest.fn().mockResolvedValue(undefined) };
  }

  describe('suspendTenant', () => {
    it('ACTIVE -> SUSPENDED: updates status, writes exactly one PlatformAuditLog via AuditService, returns the updated detail', async () => {
      const { prisma, tx } = makePrisma(activeTenant, TenantStatus.SUSPENDED);
      const audit = makeAudit();
      const service = new PlatformService(
        prisma as never,
        audit as unknown as AuditService,
      );

      const result = await service.suspendTenant(
        actor,
        'tenant-a',
        'customer requested account hold',
        '203.0.113.7',
      );

      expect(tx.tenant.updateMany).toHaveBeenCalledWith({
        where: { id: 'tenant-a', status: TenantStatus.ACTIVE },
        data: { status: TenantStatus.SUSPENDED },
      });
      expect(audit.logPlatformAction).toHaveBeenCalledTimes(1);
      expect(audit.logPlatformAction).toHaveBeenCalledWith(tx, {
        actorUserId: 'super-admin-1',
        action: 'tenant.suspend',
        targetType: 'Tenant',
        targetId: 'tenant-a',
        tenantId: 'tenant-a',
        justification: 'customer requested account hold',
        metadata: { fromStatus: 'ACTIVE', toStatus: 'SUSPENDED' },
        ip: '203.0.113.7',
      });
      expect(result.status).toBe(TenantStatus.SUSPENDED);
    });

    it('rejects a tenant that is already SUSPENDED (repeated suspend) — no update, no audit', async () => {
      const { prisma, tx } = makePrisma({
        ...activeTenant,
        status: TenantStatus.SUSPENDED,
      });
      const audit = makeAudit();
      const service = new PlatformService(
        prisma as never,
        audit as unknown as AuditService,
      );

      await expect(
        service.suspendTenant(actor, 'tenant-a', 'x', '203.0.113.7'),
      ).rejects.toThrow(ConflictException);
      expect(tx.tenant.updateMany).not.toHaveBeenCalled();
      expect(audit.logPlatformAction).not.toHaveBeenCalled();
    });

    it.each([TenantStatus.PENDING_DELETION, TenantStatus.DELETED])(
      'rejects suspend on a %s tenant — W3 implements ACTIVE<->SUSPENDED only',
      async (status) => {
        const { prisma } = makePrisma({ ...activeTenant, status });
        const audit = makeAudit();
        const service = new PlatformService(
          prisma as never,
          audit as unknown as AuditService,
        );
        await expect(
          service.suspendTenant(actor, 'tenant-a', 'x', '203.0.113.7'),
        ).rejects.toThrow(ConflictException);
      },
    );

    it('404s on a nonexistent tenant', async () => {
      const { prisma } = makePrisma(null);
      const audit = makeAudit();
      const service = new PlatformService(
        prisma as never,
        audit as unknown as AuditService,
      );
      await expect(
        service.suspendTenant(actor, 'missing', 'x', '203.0.113.7'),
      ).rejects.toThrow(NotFoundException);
    });

    it('a lost CAS race (concurrent change between the check and the update) rejects and never audits', async () => {
      const { prisma, tx } = makePrisma(activeTenant);
      tx.tenant.updateMany.mockResolvedValueOnce({ count: 0 });
      const audit = makeAudit();
      const service = new PlatformService(
        prisma as never,
        audit as unknown as AuditService,
      );

      await expect(
        service.suspendTenant(actor, 'tenant-a', 'x', '203.0.113.7'),
      ).rejects.toThrow(ConflictException);
      expect(audit.logPlatformAction).not.toHaveBeenCalled();
    });

    it('propagates an audit-write failure — the transaction rejects rather than committing the status change (real rollback proven end-to-end in the e2e suite)', async () => {
      const { prisma } = makePrisma(activeTenant);
      const audit = {
        logPlatformAction: jest
          .fn()
          .mockRejectedValue(new Error('db constraint violation')),
      };
      const service = new PlatformService(
        prisma as never,
        audit as unknown as AuditService,
      );

      await expect(
        service.suspendTenant(actor, 'tenant-a', 'x', '203.0.113.7'),
      ).rejects.toThrow('db constraint violation');
    });
  });

  describe('resumeTenant', () => {
    it('SUSPENDED -> ACTIVE: updates status and audits with the correct action/metadata', async () => {
      const { prisma, tx } = makePrisma(
        { ...activeTenant, status: TenantStatus.SUSPENDED },
        TenantStatus.ACTIVE,
      );
      const audit = makeAudit();
      const service = new PlatformService(
        prisma as never,
        audit as unknown as AuditService,
      );

      const result = await service.resumeTenant(
        actor,
        'tenant-a',
        'hold lifted',
        '203.0.113.7',
      );

      expect(tx.tenant.updateMany).toHaveBeenCalledWith({
        where: { id: 'tenant-a', status: TenantStatus.SUSPENDED },
        data: { status: TenantStatus.ACTIVE },
      });
      expect(audit.logPlatformAction).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          action: 'tenant.resume',
          metadata: { fromStatus: 'SUSPENDED', toStatus: 'ACTIVE' },
        }),
      );
      expect(result.status).toBe(TenantStatus.ACTIVE);
    });

    it('rejects a repeated resume (already ACTIVE)', async () => {
      const { prisma } = makePrisma(activeTenant);
      const audit = makeAudit();
      const service = new PlatformService(
        prisma as never,
        audit as unknown as AuditService,
      );
      await expect(
        service.resumeTenant(actor, 'tenant-a', 'x', '203.0.113.7'),
      ).rejects.toThrow(ConflictException);
    });

    it.each([TenantStatus.PENDING_DELETION, TenantStatus.DELETED])(
      'rejects resume on a %s tenant',
      async (status) => {
        const { prisma } = makePrisma({ ...activeTenant, status });
        const audit = makeAudit();
        const service = new PlatformService(
          prisma as never,
          audit as unknown as AuditService,
        );
        await expect(
          service.resumeTenant(actor, 'tenant-a', 'x', '203.0.113.7'),
        ).rejects.toThrow(ConflictException);
      },
    );
  });

  describe('getTenantDetail', () => {
    it('404s on a nonexistent tenant', async () => {
      const prisma = {
        tenant: { findUnique: jest.fn().mockResolvedValue(null) },
      };
      const service = new PlatformService(
        prisma as never,
        makeAudit() as unknown as AuditService,
      );
      await expect(service.getTenantDetail('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('assembles only the frozen safe fields (id, slug, status, createdAt, updatedAt, stores, subscription)', async () => {
      const prisma = {
        tenant: {
          findUnique: jest.fn().mockResolvedValue({
            ...activeTenant,
            stores: [
              {
                id: 'store-1',
                slug: 'primary',
                name: 'PrintForge Store',
                status: 'ACTIVE',
                isPrimary: true,
              },
            ],
            subscription: { status: 'ACTIVE' },
          }),
        },
      };
      const service = new PlatformService(
        prisma as never,
        makeAudit() as unknown as AuditService,
      );
      const detail = await service.getTenantDetail('tenant-a');
      expect(Object.keys(detail).sort()).toEqual(
        [
          'id',
          'slug',
          'status',
          'createdAt',
          'updatedAt',
          'stores',
          'subscription',
        ].sort(),
      );
      expect(detail.stores).toEqual([
        {
          id: 'store-1',
          slug: 'primary',
          name: 'PrintForge Store',
          status: 'ACTIVE',
          isPrimary: true,
        },
      ]);
    });
  });

  describe('setMaintenance', () => {
    const actor = { id: 'sa-1' } as never;

    function build(store: { id: string } | null) {
      const tx = {
        store: { findFirst: jest.fn().mockResolvedValue(store) },
        storeSetting: { upsert: jest.fn().mockResolvedValue({}) },
      };
      const prisma = {
        $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
      };
      const audit = makeAudit();
      const service = new PlatformService(
        prisma as never,
        audit as unknown as AuditService,
      );
      return { service, tx, audit };
    }

    it('writes maintenance_mode on the primary store and audits it', async () => {
      const { service, tx, audit } = build({ id: 'store-1' });
      const result = await service.setMaintenance(
        actor,
        'tenant-a',
        true,
        undefined,
        '1.2.3.4',
      );
      expect(result).toEqual({ id: 'tenant-a', maintenance: true });
      expect(tx.storeSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            storeId_key: { storeId: 'store-1', key: 'maintenance_mode' },
          },
          update: { value: 'true' },
        }),
      );
      expect(audit.logPlatformAction).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          action: 'tenant.maintenance',
          tenantId: 'tenant-a',
          metadata: { maintenance: true },
        }),
      );
    });

    it('throws NotFound and writes nothing when there is no primary store', async () => {
      const { service, tx, audit } = build(null);
      await expect(
        service.setMaintenance(actor, 'tenant-a', false, undefined, 'ip'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.storeSetting.upsert).not.toHaveBeenCalled();
      expect(audit.logPlatformAction).not.toHaveBeenCalled();
    });
  });

  describe('listTenants', () => {
    it('assembles only the frozen safe summary fields and computes pagination meta', async () => {
      const prisma = {
        tenant: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ ...activeTenant, _count: { stores: 2 } }]),
          count: jest.fn().mockResolvedValue(1),
        },
        storeSetting: {
          findMany: jest
            .fn()
            .mockResolvedValue([
              { value: 'true', store: { tenantId: 'tenant-a' } },
            ]),
        },
      };
      const service = new PlatformService(
        prisma as never,
        makeAudit() as unknown as AuditService,
      );
      const result = await service.listTenants({ page: 1, limit: 20 });
      expect(result.items).toEqual([
        {
          id: 'tenant-a',
          slug: 'tenant-a',
          status: TenantStatus.ACTIVE,
          createdAt: activeTenant.createdAt,
          storeCount: 2,
          maintenance: true,
        },
      ]);
      expect(result.meta).toEqual({
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
    });
  });

  describe('listPlatformAudit', () => {
    it('reads PlatformAuditLog only', async () => {
      const prisma = {
        platformAuditLog: {
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
        },
      };
      const service = new PlatformService(
        prisma as never,
        makeAudit() as unknown as AuditService,
      );
      await service.listPlatformAudit({ page: 1, limit: 20 });
      expect(prisma.platformAuditLog.findMany).toHaveBeenCalledTimes(1);
    });

    it('the service source never references tenantAuditLog — TenantAuditLog cannot be exposed by this file', () => {
      const source = readFileSync(
        join(__dirname, 'platform.service.ts'),
        'utf8',
      );
      expect(source).not.toMatch(/tenantAuditLog/);
    });
  });
});
