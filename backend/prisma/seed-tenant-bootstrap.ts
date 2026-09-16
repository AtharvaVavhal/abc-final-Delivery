import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { BCRYPT_COST } from '../src/common/constants/app.constants';
import { seedFreePlanCatalogue } from './free-plan-catalogue';
import { withPlatformRlsBypass } from '../src/common/tenant/tenant-rls';
import type { PrismaService } from '../src/common/database/prisma.service';

/**
 * SaaS Master Plan Phase 1 — dev/test tenant bootstrap (spec §B.8 item 6,
 * acceptance criterion AC-14).
 *
 * Creates, idempotently:
 *   - a `Free` Plan row (the minimum required for Subscription creation — the
 *     full plan catalogue + features/limits are Phase 6, NOT here)
 *   - Tenant #1 (decision D3-A: the existing deployment becomes an ordinary
 *     tenant with no implicit privileges — identified by slug in Phase 1;
 *     the real display name is a Phase 4 input)
 *   - its single primary Store
 *   - an OWNER TenantMembership for a chosen User
 *   - a Free / ACTIVE Subscription
 *   - the customer-facing `storeName` StoreSetting when missing
 *
 * DEV / TEST ONLY. Refuses to run when NODE_ENV=production. Performs no
 * production data migration and touches no existing commerce table.
 *
 * Usage:
 *   npx ts-node prisma/seed-tenant-bootstrap.ts
 *
 * Optional env:
 *   SEED_TENANT_SLUG    (default: "tenant-1")
 *   SEED_STORE_SLUG     (default: "primary")
 *   SEED_STORE_NAME     (default: "PrintForge" — matches AppSetting.storeName default)
 *   SEED_OWNER_EMAIL    (default: the first role=ADMIN user, else a created
 *                        dev user "owner@tenant-1.local")
 *   SEED_OWNER_PASSWORD (when set: create the owner if missing, or update
 *                        that user's password in place using the same
 *                        bcrypt cost as AuthService. Never logged.)
 */

loadLocalEnv();

const prisma = new PrismaClient();

function loadLocalEnv(): void {
  const envPath = resolve(__dirname, '../.env');
  let text: string;
  try {
    text = readFileSync(envPath, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function assertNotProduction(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Refusing to run: NODE_ENV=production. This Phase 1 bootstrap seed is dev/test only. ' +
        'The production Tenant #1 bootstrap is a Phase 4 step (gated on decision D2 + the restore drill).',
    );
  }
}

async function applyOwnerPassword(
  userId: string,
  password: string,
): Promise<void> {
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        role: Role.ADMIN,
        passwordHash,
        tokenVersion: { increment: 1 },
        failedLoginAttempts: 0,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
      },
    }),
    prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
}

async function resolveOwner(): Promise<{
  id: string;
  generatedPassword: string | null;
}> {
  const explicitEmail = process.env.SEED_OWNER_EMAIL?.trim().toLowerCase();
  if (explicitEmail) {
    const supplied = process.env.SEED_OWNER_PASSWORD;
    const existing = await prisma.user.findUnique({
      where: { email: explicitEmail },
    });
    if (existing) {
      if (supplied) {
        await applyOwnerPassword(existing.id, supplied);
      } else if (existing.role !== Role.ADMIN) {
        await prisma.user.update({
          where: { id: existing.id },
          data: { role: Role.ADMIN },
        });
      }
      return { id: existing.id, generatedPassword: null };
    }

    const generatedPassword = supplied
      ? null
      : randomBytes(18).toString('base64url');
    const password = supplied || generatedPassword;
    if (!password) {
      throw new Error('SEED_OWNER_PASSWORD resolved empty');
    }
    const created = await prisma.user.create({
      data: {
        email: explicitEmail,
        passwordHash: await bcrypt.hash(password, BCRYPT_COST),
        role: Role.ADMIN,
      },
    });
    return { id: created.id, generatedPassword };
  }

  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
    orderBy: { createdAt: 'asc' },
  });
  if (admin) {
    return { id: admin.id, generatedPassword: null };
  }

  const devEmail = 'owner@tenant-1.local';
  const created = await prisma.user.upsert({
    where: { email: devEmail },
    update: {},
    // A non-usable password hash — this dev user is a membership holder only,
    // not a login. Real merchant auth for Tenant #1's owner is wired in Phase 2.
    create: { email: devEmail, passwordHash: `disabled-${randomUUID()}` },
  });
  return { id: created.id, generatedPassword: null };
}

async function main(): Promise<void> {
  assertNotProduction();

  const tenantSlug = process.env.SEED_TENANT_SLUG?.trim() || 'tenant-1';
  const storeSlug = process.env.SEED_STORE_SLUG?.trim() || 'primary';
  const storeName = process.env.SEED_STORE_NAME?.trim() || 'PrintForge';

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

  const owner = await resolveOwner();

  // tenants/stores/tenant_memberships/subscriptions carry Phase 3 RLS
  // (migration 20260907183000_enable_rls_tenancy_tables): every row must
  // satisfy `bypass_flag = 'true' OR scope_column = current_setting(tenant_id)`,
  // and this bootstrap runs before any tenant context exists — exactly the
  // platform-scoped case `withPlatformRlsBypass()` (src/common/tenant/
  // tenant-rls.ts) exists for. `prisma` here is a standalone PrismaClient
  // (this script runs outside Nest DI), not the injected PrismaService the
  // helper's signature names; it only ever calls `.$transaction()`, which
  // both share, so the cast is safe.
  const { tenant, store, membership, subscription } = await withPlatformRlsBypass(
    prisma as unknown as PrismaService,
    async (tx) => {
      const tenant = await tx.tenant.upsert({
        where: { slug: tenantSlug },
        update: {},
        create: { slug: tenantSlug, status: 'ACTIVE' },
      });

      const store = await tx.store.upsert({
        where: { tenantId_slug: { tenantId: tenant.id, slug: storeSlug } },
        update: { name: storeName },
        create: {
          tenantId: tenant.id,
          slug: storeSlug,
          name: storeName,
          status: 'ACTIVE',
          isPrimary: true,
        },
      });

      const membership = await tx.tenantMembership.upsert({
        where: { userId_tenantId: { userId: owner.id, tenantId: tenant.id } },
        update: {},
        create: {
          userId: owner.id,
          tenantId: tenant.id,
          role: 'OWNER',
          status: 'ACTIVE',
        },
      });

      const subscription = await tx.subscription.upsert({
        where: { tenantId: tenant.id },
        update: {},
        create: {
          tenantId: tenant.id,
          planId: plan.id,
          status: 'ACTIVE',
          currentPeriodStart: new Date(),
        },
      });

      return { tenant, store, membership, subscription };
    },
    // Default interactive-transaction timeout is 5s; four sequential
    // round-trips to the remote Render Postgres instance routinely exceed
    // that, so this raises it for this call site only (tenant-rls.ts's
    // helpers default to Prisma's normal timeout everywhere else).
    { timeout: 20_000 },
  );

  // StoreSetting is not one of the six FORCE-RLS tenancy tables. Create the
  // customer-facing store name on first run only so a later admin edit is
  // not clobbered by a second bootstrap.
  await prisma.storeSetting.upsert({
    where: { storeId_key: { storeId: store.id, key: 'storeName' } },
    update: {},
    create: {
      tenantId: tenant.id,
      storeId: store.id,
      key: 'storeName',
      value: storeName,
    },
  });

  console.log('Phase 1 tenant bootstrap complete:');
  console.log(
    `  plan         ${plan.key} (${plan.id}) catalogue: ${catalogue.featuresWritten} feature(s), ${catalogue.limitsWritten} limit(s)`,
  );
  console.log(`  tenant       ${tenant.slug} (${tenant.id}) status=${tenant.status}`);
  console.log(`  store        ${store.slug} "${store.name}" (${store.id}) isPrimary=${store.isPrimary}`);
  console.log(`  membership   OWNER user=${owner.id} status=${membership.status} (${membership.id})`);
  console.log(`  subscription ${subscription.status} plan=${plan.key} (${subscription.id})`);
  if (process.env.SEED_OWNER_EMAIL?.trim()) {
    console.log(
      `  owner login  ${process.env.SEED_OWNER_EMAIL.trim().toLowerCase()} (password ${
        owner.generatedPassword ? 'generated-once' : 'from SEED_OWNER_PASSWORD or pre-existing'
      })`,
    );
  }
  if (owner.generatedPassword) {
    console.log(
      '  owner pass   (generated — not printed; re-run with SEED_OWNER_PASSWORD to set a known value)',
    );
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
