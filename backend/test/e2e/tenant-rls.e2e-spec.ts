import { readFileSync } from 'fs';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createTestApp } from './support/test-app';
import { PrismaService } from '../../src/common/database/prisma.service';

/**
 * Phase 3 — RLS defense-in-depth (decision D4; migration
 * `20260907183000_enable_rls_tenancy_tables`). Verifies the migration's SQL
 * is correct against a real Postgres, WITHOUT ever enabling RLS persistently
 * on the shared `printforge_test` database — Postgres DDL (including
 * `ENABLE/FORCE ROW LEVEL SECURITY` and `CREATE POLICY`) is transactional,
 * so the entire migration + fixtures + assertions run inside one
 * transaction that is always rolled back at the end (deliberately throwing
 * a sentinel after assertions pass). This leaves `printforge_test`'s schema
 * and every other e2e spec in the suite completely unaffected — applying
 * the migration for real to any shared database is a separate, future,
 * explicitly-authorized production step (see the migration file's own
 * header comment and the Phase 3 implementation report).
 */
describe('Phase 3 — RLS defense-in-depth (migration correctness, isolated)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let migrationSql: string;

  const ROLLBACK_SENTINEL = 'ROLLBACK_SENTINEL_DO_NOT_LEAK';

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    migrationSql = readFileSync(
      join(
        __dirname,
        '../../prisma/migrations/20260907183000_enable_rls_tenancy_tables/migration.sql',
      ),
      'utf8',
    );
  });

  afterAll(async () => {
    await app.close();
  });

  /** `$executeRawUnsafe` accepts exactly one SQL command per call — strip
   * `-- line` comments FIRST (a comment line has no terminating `;`, so
   * splitting before stripping would glue a whole comment block onto the
   * next real statement), then split the remaining `;`-terminated
   * statements and run them one at a time. */
  async function applyMigrationSql(
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const withoutComments = migrationSql.replace(/--[^\n]*/g, '');
    const statements = withoutComments
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      try {
        await tx.$executeRawUnsafe(stmt);
      } catch (err) {
        // CI (and any fully-migrated database) already applied this
        // migration via `prisma migrate deploy`. Re-running CREATE POLICY
        // then raises Postgres 42710 (duplicate_object). ENABLE/FORCE RLS
        // are idempotent; only CREATE POLICY is not. Swallow that so the
        // rolled-back probes still exercise the already-installed policy.
        // Prisma surfaces the Postgres code either as `err.code` or inside
        // a P2010 "Raw query failed. Code: `42710`" wrapper.
        const prismaCode =
          err instanceof Prisma.PrismaClientKnownRequestError
            ? err.code
            : '';
        const message = err instanceof Error ? err.message : String(err);
        if (
          prismaCode === '42710' ||
          prismaCode === 'P2010' ||
          /already exists/i.test(message) ||
          /42710/.test(message)
        ) {
          continue;
        }
        throw err;
      }
    }
  }

  /** Runs `body` inside a transaction that always rolls back, regardless of
   * outcome — `body`'s assertions run for real against the real database,
   * but nothing persists. */
  async function inRolledBackTransaction(
    body: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<void> {
    try {
      await prisma.$transaction(
        async (tx) => {
          await body(tx);
          throw new Error(ROLLBACK_SENTINEL);
        },
        { timeout: 20_000 },
      );
    } catch (err) {
      if (err instanceof Error && err.message === ROLLBACK_SENTINEL) {
        return;
      }
      throw err;
    }
  }

  it('the migration file itself contains ENABLE + FORCE + a policy for all six tenancy tables', () => {
    const tables = [
      'tenants',
      'stores',
      'store_domains',
      'tenant_memberships',
      'subscriptions',
      'customers',
    ];
    for (const t of tables) {
      expect(migrationSql).toMatch(
        new RegExp(`ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY`),
      );
      expect(migrationSql).toMatch(
        new RegExp(`ALTER TABLE "${t}" FORCE ROW LEVEL SECURITY`),
      );
      expect(migrationSql).toMatch(new RegExp(`CREATE POLICY .* ON "${t}"`));
    }
    // No business/commerce table is touched by this migration.
    for (const forbidden of ['orders', 'carts', 'reviews', 'users']) {
      expect(migrationSql).not.toMatch(
        new RegExp(`ALTER TABLE "${forbidden}"`),
      );
    }
  });

  const RLS_TABLES = [
    'tenants',
    'stores',
    'store_domains',
    'tenant_memberships',
    'subscriptions',
    'customers',
    'plans',
  ];

  /**
   * The local test database connects as a Postgres SUPERUSER (also
   * BYPASSRLS) — confirmed via `SELECT rolsuper, rolbypassrls FROM
   * pg_roles`. A superuser unconditionally bypasses RLS regardless of
   * `FORCE ROW LEVEL SECURITY` (a hard Postgres guarantee, not a
   * misconfiguration) — production's application role is NOT a superuser
   * (P3-D2, docs/saas/DECISIONS.md), so this gap is local-environment-only,
   * not a production risk. To actually exercise enforcement here, this
   * creates a temporary, ordinary (`NOSUPERUSER NOBYPASSRLS`) role and
   * `SET LOCAL ROLE`s to it for the assertion phase — the standard
   * technique for testing RLS policies from a privileged connection.
   * `CREATE ROLE` is transactional in Postgres (verified empirically) —
   * rolling back this transaction removes the role along with everything
   * else; nothing here persists.
   */
  async function becomeOrdinaryRole(
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const roleName = `rls_probe_${Date.now()}`;
    await tx.$executeRawUnsafe(
      `CREATE ROLE "${roleName}" LOGIN NOSUPERUSER NOBYPASSRLS`,
    );
    await tx.$executeRawUnsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ${RLS_TABLES.map((t) => `"${t}"`).join(', ')} TO "${roleName}"`,
    );
    await tx.$executeRawUnsafe(`SET LOCAL ROLE "${roleName}"`);
  }

  it('fails closed: with RLS enabled and no session variable set, an ordinary (non-superuser) role sees zero rows', async () => {
    await inRolledBackTransaction(async (tx) => {
      await applyMigrationSql(tx);
      const tenant = await tx.tenant.create({
        data: { slug: `rls-test-${Date.now()}` },
      });
      expect(tenant.id).toBeTruthy();

      await becomeOrdinaryRole(tx);

      // No app.tenant_id / app.bypass_tenant_rls set for this role in this
      // transaction — current_setting(..., true) is NULL, every comparison
      // is NULL (falsy), so the row created above (as the superuser, before
      // switching role) must be invisible.
      const visible = await tx.tenant.findMany({ where: { id: tenant.id } });
      expect(visible).toHaveLength(0);
    });
  });

  it("a tenant sees only its own row once app.tenant_id is set, never a sibling tenant's", async () => {
    await inRolledBackTransaction(async (tx) => {
      await applyMigrationSql(tx);
      const tenantA = await tx.tenant.create({
        data: { slug: `rls-a-${Date.now()}` },
      });
      const tenantB = await tx.tenant.create({
        data: { slug: `rls-b-${Date.now()}` },
      });

      await becomeOrdinaryRole(tx);
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantA.id}, true)`;

      const seenAsA = await tx.tenant.findMany({
        where: { id: { in: [tenantA.id, tenantB.id] } },
      });
      expect(seenAsA.map((t) => t.id)).toEqual([tenantA.id]);
    });
  });

  it('the platform-bypass flag makes rows visible across tenants (the two named exempt call sites only)', async () => {
    await inRolledBackTransaction(async (tx) => {
      await applyMigrationSql(tx);
      const tenantA = await tx.tenant.create({
        data: { slug: `rls-bypass-a-${Date.now()}` },
      });
      const tenantB = await tx.tenant.create({
        data: { slug: `rls-bypass-b-${Date.now()}` },
      });

      await becomeOrdinaryRole(tx);
      await tx.$executeRaw`SELECT set_config('app.bypass_tenant_rls', 'true', true)`;

      const seenWithBypass = await tx.tenant.findMany({
        where: { id: { in: [tenantA.id, tenantB.id] } },
      });
      expect(seenWithBypass.map((t) => t.id).sort()).toEqual(
        [tenantA.id, tenantB.id].sort(),
      );
    });
  });

  // Two separate transactions — Postgres aborts a transaction entirely on
  // the first error within it (all subsequent statements fail with 25P02
  // until ROLLBACK), so the "rejected" and "succeeds" cases cannot share
  // one transaction.

  it('an INSERT for a tenant other than the current app.tenant_id is rejected (WITH CHECK), not merely an FK mismatch', async () => {
    await inRolledBackTransaction(async (tx) => {
      await applyMigrationSql(tx);
      const tenantA = await tx.tenant.create({
        data: { slug: `rls-check-a-${Date.now()}` },
      });
      // tenantB is a REAL, existing tenant — so a rejection can only be
      // RLS's WITH CHECK, never a foreign-key violation (which a garbage
      // tenantId string would also (mis)trigger, producing a false pass).
      const tenantB = await tx.tenant.create({
        data: { slug: `rls-check-b-${Date.now()}` },
      });
      const plan = await tx.plan.create({
        data: { key: `rls-plan-${Date.now()}`, name: 'RLS test plan' },
      });

      await becomeOrdinaryRole(tx);
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantA.id}, true)`;

      await expect(
        tx.subscription.create({
          data: { tenantId: tenantB.id, planId: plan.id },
        }),
      ).rejects.toThrow();
    });
  });

  it('the matching-tenant INSERT succeeds under the identical policy', async () => {
    await inRolledBackTransaction(async (tx) => {
      await applyMigrationSql(tx);
      const tenantA = await tx.tenant.create({
        data: { slug: `rls-check-ok-${Date.now()}` },
      });
      const plan = await tx.plan.create({
        data: { key: `rls-plan-ok-${Date.now()}`, name: 'RLS test plan' },
      });

      await becomeOrdinaryRole(tx);
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantA.id}, true)`;

      const created = await tx.subscription.create({
        data: { tenantId: tenantA.id, planId: plan.id },
      });
      expect(created.tenantId).toBe(tenantA.id);
    });
  });
});
