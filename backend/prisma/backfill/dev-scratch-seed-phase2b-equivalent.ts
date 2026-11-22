import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { seedFreePlanCatalogue } from '../free-plan-catalogue';

/**
 * LOCAL DRY-RUN PREREQUISITE ONLY — NOT PART OF W4, NOT FOR PRODUCTION.
 *
 * Phase 4 (W4/W5) backfill assigns existing commerce rows to Tenant #1 /
 * its primary Store, and derives `customerId` via a `Customer` row. In
 * production that foundation (Tenant #1, primary Store, `TenantMembership`,
 * `Customer`) already exists — Phase 2b executed it against production on
 * 2026-09-07 (docs/saas/PHASE-2B-IMPLEMENTATION-REPORT.md). Local
 * `printforge_dev`/`printforge_test` never had Phase 2b run against them
 * (verified: 0 rows in `tenants`/`stores`/`customers`/`tenant_memberships`
 * before this script), so a realistic local dry run needs the identical
 * foundation seeded locally first — this script does exactly that, using
 * the SAME idempotent `INSERT ... SELECT ... WHERE NOT EXISTS` shape Phase
 * 2b's own implementation report documents (§2), with the SAME slugs/names
 * production actually has (`printforge` / `printforge` / "PrintForge
 * Store"), so the local backfill dry run exercises the real target
 * identifiers this Phase 4 spec and decision set refer to throughout.
 *
 * This script does NOT touch any commerce table (categories, products,
 * orders, carts, etc.) — it only creates the SaaS-foundation rows Phase 2b
 * already created in production. The actual W4/W5 backfill (w4-backfill.ts)
 * is a separate, later step.
 *
 * Refuses to run when NODE_ENV=production or DATABASE_URL doesn't look
 * local — Phase 2b already executed this exact bootstrap against
 * production; running it again there is unnecessary and this script is not
 * the reviewed/authorized production artifact for that (Phase 2b's own raw
 * SQL, already executed and evidenced, is).
 *
 * Usage: npx ts-node prisma/backfill/dev-scratch-seed-phase2b-equivalent.ts
 */

const prisma = new PrismaClient();

const TENANT_SLUG = 'printforge';
const STORE_SLUG = 'printforge';
const STORE_NAME = 'PrintForge Store';

function assertLocalOnly(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Refusing to run: NODE_ENV=production. This is a local dry-run prerequisite only — ' +
        'Phase 2b already executed the real equivalent against production (see docs/saas/PHASE-2B-IMPLEMENTATION-REPORT.md).',
    );
  }
  const url = process.env.DATABASE_URL ?? '';
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    throw new Error(
      `Refusing to run: DATABASE_URL does not look local ("${url.replace(/:[^:@]*@/, ':****@')}"). ` +
        'This script is local-dry-run-only.',
    );
  }
}

async function main(): Promise<void> {
  assertLocalOnly();

  const plan = await prisma.plan.upsert({
    where: { key: 'free' },
    update: {},
    // P6-D1 — isActive/sortOrder/isEnterpriseCustom are nullable at the DB
    // level (G-19 forces this on the pre-existing `plans` table) with no
    // DB-level default, so a create() that omits them would silently
    // insert NULL rather than their intended default. Explicit here for
    // the same reason PlatformPlansService.createPlan() is explicit.
    create: {
      key: 'free',
      name: 'Free',
      // Explicit here to match the approved Free-plan spec
      // (docs/saas/DECISIONS.md) and seed-tenant-bootstrap.ts's own
      // Plan.create — `isPublic` already defaults to `true` at the DB
      // level (schema.prisma), so this changes no runtime behavior for a
      // freshly-created row; it only makes both canonical bootstrap paths
      // consistent with each other and with the approved spec.
      isPublic: true,
      isActive: true,
      sortOrder: 0,
      isEnterpriseCustom: false,
    },
  });

  // Phase 6 W5 — business-approved Free-plan PlanFeature/PlanLimit
  // catalogue (docs/saas/DECISIONS.md). Idempotent upsert, safe on every
  // run, converges the catalogue to the approved values regardless of
  // whether `plan` above was just created or already existed.
  const catalogue = await seedFreePlanCatalogue(prisma, plan.id);

  const tenant = await prisma.tenant.upsert({
    where: { slug: TENANT_SLUG },
    update: {},
    create: { slug: TENANT_SLUG },
  });

  const store = await prisma.store.upsert({
    where: { tenantId_slug: { tenantId: tenant.id, slug: STORE_SLUG } },
    update: {},
    create: {
      tenantId: tenant.id,
      slug: STORE_SLUG,
      name: STORE_NAME,
      status: 'ACTIVE',
      isPrimary: true,
    },
  });

  const subscription = await prisma.subscription.upsert({
    where: { tenantId: tenant.id },
    update: {},
    create: { tenantId: tenant.id, planId: plan.id, status: 'ACTIVE' },
  });

  const admins = await prisma.user.findMany({ where: { role: 'ADMIN' } });
  let membershipsCreated = 0;
  for (const admin of admins) {
    const existing = await prisma.tenantMembership.findUnique({
      where: { userId_tenantId: { userId: admin.id, tenantId: tenant.id } },
    });
    if (existing) continue;
    await prisma.tenantMembership.create({
      data: {
        userId: admin.id,
        tenantId: tenant.id,
        role: 'OWNER',
        status: 'ACTIVE',
      },
    });
    membershipsCreated++;
  }

  const customersUsers = await prisma.user.findMany({
    where: { role: 'CUSTOMER' },
  });
  let customersCreated = 0;
  for (const u of customersUsers) {
    // Phone-only (OTP) users have no email/password to copy into a Customer.
    if (!u.email || !u.passwordHash) continue;
    const existing = await prisma.customer.findUnique({
      where: { storeId_email: { storeId: store.id, email: u.email } },
    });
    if (existing) continue;
    await prisma.customer.create({
      data: {
        id: randomUUID(),
        storeId: store.id,
        tenantId: tenant.id,
        email: u.email,
        passwordHash: u.passwordHash,
        tokenVersion: u.tokenVersion,
        failedLoginAttempts: u.failedLoginAttempts,
        passwordResetTokenHash: u.passwordResetTokenHash,
        passwordResetExpiresAt: u.passwordResetExpiresAt,
        isActive: u.isActive,
        addressLine1: u.addressLine1,
        addressLine2: u.addressLine2,
        city: u.city,
        state: u.state,
        postalCode: u.postalCode,
        country: u.country,
        phone: u.phone,
      },
    });
    customersCreated++;
  }

  console.log(
    JSON.stringify(
      {
        tenantId: tenant.id,
        storeId: store.id,
        subscriptionId: subscription.id,
        planCatalogue: catalogue,
        adminsSeen: admins.length,
        membershipsCreated,
        customersSeen: customersUsers.length,
        customersCreated,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
