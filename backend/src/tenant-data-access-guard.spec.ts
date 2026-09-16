import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Phase 3 — tenant-data-access CI guard (SaaS Master Plan §9 "CI gate: no
 * domain service imports `PrismaService` directly outside the allowlist";
 * `PHASE-3-START-GATE-AND-IMPLEMENTATION-SPEC.md` §10, §14; independent
 * audit P1 finding, closed here).
 *
 * D4 (docs/saas/DECISIONS.md, resolved 2026-09-07) makes the tenant-scoped
 * Prisma client (`common/tenant/tenant-prisma.ts`) the PRIMARY isolation
 * mechanism for the six Phase 1/2a tenancy tables (`tenants`, `stores`,
 * `store_domains`, `tenant_memberships`, `subscriptions`, `customers`).
 * This guard enforces that boundary mechanically: no file under `src/`,
 * outside a small, explicitly named allowlist, may read or write one of
 * those six models directly through the raw `PrismaService` (bypassing the
 * scoped client entirely).
 *
 * Scope note (why this does NOT scan for "any `PrismaService` import" —
 * that would fail almost the entire codebase and weaken nothing, since no
 * commerce table carries a `tenantId` column yet — Phase 4's backfill; see
 * `PHASE-3-IMPLEMENTATION-REPORT.md` §6/§11). Every commerce-domain service
 * (`orders`, `payments`, `checkout`, `cart`, …) correctly and necessarily
 * still uses the raw `PrismaService` for its OWN (non-tenancy) tables today
 * — that is unrelated to this guard, which targets only the six named
 * tenancy models specifically. Extending the guard to a business-table
 * scope is Phase 4's own concern once those tables gain `tenantId`.
 *
 * Detection heuristic (matches this codebase's one consistent convention —
 * verified: every `PrismaService` injection site in `src/` uses the
 * property/parameter name `prisma`, and every interactive-transaction
 * callback in this codebase names its parameter `tx`):
 *   1. A direct delegate call on the six tenancy models:
 *      `(this.)?(prisma|tx).<model>.<operation>(`
 *   2. The `tenantMemberships` relation-include key (the one legitimate
 *      existing access pattern that is NOT a direct delegate call —
 *      `JwtStrategy` loads a `User`'s own memberships via
 *      `prisma.user.findUnique({ include: { tenantMemberships: {...} } })`).
 *
 * Do not weaken this guard to make an unapproved import pass — the correct
 * fix for a genuine new cross-tenant need is to add the specific file to
 * the allowlist below with a comment explaining why, the same discipline
 * `migration-safety.spec.ts`'s `LEGACY_MIGRATIONS` and G-19/D4-G-20
 * extensions already follow in this codebase.
 */

const SRC_DIR = join(__dirname);

const TENANCY_MODELS = [
  'tenant',
  'store',
  'storeDomain',
  'tenantMembership',
  'subscription',
  'customer',
] as const;

const DIRECT_DELEGATE_PATTERN = new RegExp(
  `\\b(?:this\\.)?(?:prisma|tx)\\.(?:${TENANCY_MODELS.join('|')})\\.\\w+\\(`,
);
const MEMBERSHIP_INCLUDE_PATTERN = /\btenantMemberships\s*:\s*\{/;

/**
 * Explicitly approved bypass sites (SaaS Master Plan §9 "platform-scoped
 * operations identified explicitly"; independent audit finding). Paths are
 * relative to `backend/src/`. Adding an entry here is itself a decision —
 * see the file header.
 */
const ALLOWLIST: ReadonlyArray<{ path: string; category: string }> = [
  {
    path: 'common/tenant/tenant-context.guard.ts',
    category:
      'tenant-context.guard.ts (resolves a tenant FROM a hostname — no tenant is known yet)',
  },
  {
    path: 'common/tenant/storefront-tenant.resolver.ts',
    category:
      "storefront-tenant.resolver.ts (Phase 4 W7 / P4-D2 — the storefront/customer-path counterpart of tenant-context.guard.ts's own host lookup: resolves a tenant FROM a hostname, or the sole existing tenant, for a caller with no TenantMembership to resolve one from — no tenant is known yet). Reads tenancy rows via one parameterized SQL statement inside withPlatformRlsBypass, not Prisma delegates, so the detector below does not currently fire on this file; it stays allowlisted because it is still the storefront bypass site.",
  },
  {
    path: 'auth/strategies/jwt.strategy.ts',
    category:
      "jwt.strategy.ts (loads a User's own memberships across every tenant they hold, before any tenant is selected)",
  },
  // "auth" — the rest of the auth module (identity is global; Master Plan
  // §9: "Auth endpoints — none [tenant context]"). No file here currently
  // matches the detection patterns; listed for completeness per the named
  // exemption category, not because it's needed to pass today.
  { path: 'auth/auth.service.ts', category: 'auth (identity is global)' },
  { path: 'auth/auth.controller.ts', category: 'auth (identity is global)' },
  // "health" — no tenant context at all (Master Plan §9).
  {
    path: 'common/health/health.controller.ts',
    category: 'health (no tenant context)',
  },
  // "cron pollers" — iterate across every tenant by design; the *poller*
  // is never scoped to one tenant (Master Plan §9); each *job* carries
  // tenant context (Phase 11), not modeled here.
  {
    path: 'payments/payment-reconciliation.service.ts',
    category: 'cron poller',
  },
  {
    path: 'payments/webhooks/webhook-processor.service.ts',
    category: 'cron poller',
  },
  { path: 'notifications/outbox/outbox.poller.ts', category: 'cron poller' },
  // "platform admin" — cross-tenant by design (Phase 5, SUPER_ADMIN +
  // audit; W3). `PlatformService` is exactly the "narrowly scoped platform
  // service querying the Tenant table for platform-level tenant
  // management" the Phase 5 plan names as the one legitimate exception —
  // gated entirely by `PlatformGuard`/`@PlatformOnly()` upstream
  // (`platform.controller.ts`), never reachable by a tenant user, and
  // touches no business/commerce/customer table anywhere in the file.
  {
    path: 'platform/platform.service.ts',
    category:
      'platform admin (Phase 5 W3 — SUPER_ADMIN tenant list/detail/suspend/resume, gated by PlatformGuard)',
  },
  // "tenant lifecycle" — Phase 5 W4's single, shared ACTIVE/SUSPENDED
  // check (SaaS Master Plan §11). Reads only `Tenant.status` by id, never
  // any other tenancy model, never a business/commerce table. Called from
  // three gated contexts (TenantLifecycleGuard after TenantContextGuard;
  // StorefrontTenantResolver's own already-allowlisted resolution; and
  // CheckoutService reading an already-loaded cart's own tenantId) — it is
  // not itself a new cross-tenant read path, just the one place the
  // resulting status check lives instead of being duplicated three times.
  {
    path: 'common/tenant/tenant-lifecycle.ts',
    category:
      'tenant lifecycle (Phase 5 W4 — ACTIVE/SUSPENDED check, read-only, id-scoped)',
  },
  // "support-session lifecycle" — Phase 5 W6's SupportSession create/
  // revoke/list, cross-tenant by design (SUPER_ADMIN + audit; same
  // category the header above already names for `platform.service.ts`).
  // Reads/writes `Tenant` only to validate a creation target's existence/
  // ACTIVE status — never any other tenancy model, never a business/
  // commerce table — gated entirely by `PlatformGuard`/`@PlatformOnly()`
  // upstream (`support-session.controller.ts`), never reachable by a
  // tenant user or an in-progress support session itself.
  {
    path: 'support-sessions/support-session.service.ts',
    category:
      'platform admin (Phase 5 W6 — SUPER_ADMIN support-session create/revoke/list, gated by PlatformGuard)',
  },
  // "team management" — Phase 5 W7's Tenant Control Plane team list/
  // invite/role-change/suspend. Reads/writes `TenantMembership` only,
  // every query filtered by the caller's own server-derived
  // TenantContext.tenantId (never a client-supplied value) — gated
  // entirely by PermissionsGuard's `members:manage` check (G-13: OWNER
  // only, unmodified), never reachable without it. Touches no other D4
  // tenancy model and no business/commerce table anywhere in the file.
  {
    path: 'team/team.service.ts',
    category:
      'tenant admin (Phase 5 W7 — OWNER team list/invite/role-change/suspend, gated by PermissionsGuard members:manage)',
  },
  // "tenant audit actor attribution" — Phase 5 W8's shared helper, used by
  // every W8-audited Tenant Control Plane service to resolve
  // `actorMembershipId`/`viaSupportSessionId` for a `TenantAuditLog` write.
  // Reads only the CALLER's own membership row, by the unique
  // (userId, tenantId) key, using the caller's already server-derived
  // TenantContext — never a client-supplied membership id, never any
  // other tenant's row. Extracted from `team.service.ts`'s own W7 logic
  // (same category) so every new audited service shares one proven
  // implementation instead of reimplementing it slightly differently.
  {
    path: 'common/audit/tenant-actor-attribution.ts',
    category:
      'tenant admin (Phase 5 W8 — shared actor-attribution helper for TenantAuditLog writes)',
  },
  // "platform admin" — Phase 6 W1's Platform Control Plane catalogue CRUD
  // (Plan/PlanFeature/PlanLimit/TenantEntitlementOverride), same category
  // already named above for `platform.service.ts`: cross-tenant by design
  // (SUPER_ADMIN + audit), gated entirely by `PlatformGuard`/
  // `@PlatformOnly()` upstream (`platform-plans.controller.ts`), never
  // reachable by a tenant user. Reads `Tenant` only to validate an
  // override's target tenant exists, and `Subscription` only via a
  // `count()` pre-check before a Plan hard-delete (the real FK-level
  // authority is `Subscription.plan`'s own `onDelete: Restrict`, unchanged
  // by this file) — never any other tenancy model, never a business/
  // commerce/customer table anywhere in the file.
  {
    path: 'platform/platform-plans/platform-plans.service.ts',
    category:
      'platform admin (Phase 6 W1 — SUPER_ADMIN plan/feature/limit/override catalogue CRUD, gated by PlatformGuard)',
  },
  // "ops CLI script" — Phase 8 (P8-13, P1 #1 remediation,
  // docs/saas/PHASE-8-SECURITY-AUDIT.md §18/§19). NOT reachable via any
  // HTTP route, any guard, or any request context at all — a standalone,
  // read-only operator script (`prisma/ops/payment-account-readiness-check.ts`)
  // run manually before a Phase 8 deploy, same "cross-tenant by design"
  // category the header above already names for cron pollers/platform
  // admin, but with an even smaller attack surface: no controller, no
  // guard to bypass, because there is no HTTP entry point whatsoever.
  // Reads `Store` (id/tenantId/name/status/slug only, plus its
  // `paymentAccounts` relation's id/status — never `credentialsEncrypted`
  // or any other credential field) across every tenant, by design — the
  // whole point is to report which tenants/stores are NOT yet ready for
  // Phase 8 payment code, which is structurally impossible to answer
  // scoped to one tenant. Never writes anything (see the file's own doc
  // comment) and touches no other tenancy or commerce table.
  {
    path: 'payments/payment-accounts/payment-account-readiness.ts',
    category:
      'ops CLI script (P8-13 — read-only, cross-tenant PaymentAccount readiness report, no HTTP entry point)',
  },
];

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      files.push(full);
    }
  }
  return files;
}

interface Violation {
  relativePath: string;
  reason: string;
}

function findViolations(): Violation[] {
  const allowedPaths = new Set(ALLOWLIST.map((a) => a.path));
  const violations: Violation[] = [];

  for (const absPath of walk(SRC_DIR)) {
    const relativePath = absPath.slice(SRC_DIR.length + 1);
    if (allowedPaths.has(relativePath)) {
      continue;
    }
    // The scoping mechanism's own implementation is generic ($allModels)
    // and never names a tenancy model literally — it would not match
    // either pattern, but is excluded on principle, not necessity.
    if (relativePath.startsWith('common/tenant/tenant-prisma.ts')) {
      continue;
    }

    const code = stripComments(readFileSync(absPath, 'utf8'));
    if (DIRECT_DELEGATE_PATTERN.test(code)) {
      violations.push({
        relativePath,
        reason:
          'direct PrismaService delegate call on a tenancy model outside the allowlist',
      });
      continue;
    }
    if (MEMBERSHIP_INCLUDE_PATTERN.test(code)) {
      violations.push({
        relativePath,
        reason: '`tenantMemberships` relation include outside the allowlist',
      });
    }
  }

  return violations;
}

describe('tenant data access — PrismaService allowlist guard (D4, Phase 3)', () => {
  it('every allowlisted file actually exists', () => {
    for (const entry of ALLOWLIST) {
      expect(() =>
        readFileSync(join(SRC_DIR, entry.path), 'utf8'),
      ).not.toThrow();
    }
  });

  it('the ten known, currently-existing access sites are exactly jwt.strategy.ts, tenant-context.guard.ts, platform.service.ts, tenant-lifecycle.ts, support-session.service.ts, team.service.ts, tenant-actor-attribution.ts, platform-plans.service.ts, and payment-account-readiness.ts (storefront-tenant.resolver.ts remains allowlisted but currently reads via $queryRaw, not a Prisma tenancy delegate)', () => {
    const detectedTodayFiles = ALLOWLIST.filter((a) => {
      try {
        const code = stripComments(readFileSync(join(SRC_DIR, a.path), 'utf8'));
        return (
          DIRECT_DELEGATE_PATTERN.test(code) ||
          MEMBERSHIP_INCLUDE_PATTERN.test(code)
        );
      } catch {
        return false;
      }
    }).map((a) => a.path);
    expect(detectedTodayFiles.sort()).toEqual(
      [
        'auth/strategies/jwt.strategy.ts',
        'common/tenant/tenant-context.guard.ts',
        'platform/platform.service.ts',
        'common/tenant/tenant-lifecycle.ts',
        'support-sessions/support-session.service.ts',
        'team/team.service.ts',
        'common/audit/tenant-actor-attribution.ts',
        'platform/platform-plans/platform-plans.service.ts',
        'payments/payment-accounts/payment-account-readiness.ts',
      ].sort(),
    );
  });

  it('no file outside the allowlist accesses a tenancy model directly', () => {
    const violations = findViolations();
    expect(violations).toEqual([]);
  });

  it('the detector actually fires on a direct, unauthorized delegate call (positive control)', () => {
    const code =
      'async function f(prisma) { return prisma.customer.findMany({}); }';
    expect(DIRECT_DELEGATE_PATTERN.test(code)).toBe(true);
  });

  it('the detector actually fires on an unauthorized tenantMemberships include (positive control)', () => {
    const code =
      'prisma.user.findUnique({ include: { tenantMemberships: { where: {} } } })';
    expect(MEMBERSHIP_INCLUDE_PATTERN.test(code)).toBe(true);
  });

  it('the detector does NOT fire on an unrelated "customer" identifier that is not a Prisma delegate call', () => {
    const code =
      'const customer = { name: "test" }; console.log(customer.email);';
    expect(DIRECT_DELEGATE_PATTERN.test(code)).toBe(false);
  });

  it('the detector does NOT fire on the tenant-scoped client itself ($allModels is generic, names no model literally)', () => {
    const code = readFileSync(
      join(SRC_DIR, 'common/tenant/tenant-prisma.ts'),
      'utf8',
    );
    const stripped = stripComments(code);
    expect(DIRECT_DELEGATE_PATTERN.test(stripped)).toBe(false);
    expect(MEMBERSHIP_INCLUDE_PATTERN.test(stripped)).toBe(false);
  });
});
