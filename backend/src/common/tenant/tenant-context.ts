import type { TenantRole } from '@prisma/client';
import type { Permission } from '../../auth/permissions/permission';

/**
 * Server-derived tenant context (SaaS Master Plan §9; decision D6,
 * docs/saas/DECISIONS.md, resolved 2026-09-07 — BOTH host/subdomain and
 * `X-Active-Tenant` header, header cross-validated against the caller's
 * `ACTIVE` `TenantMembership` rows).
 *
 * `TenantContextGuard` is the ONLY place that constructs this for the
 * ordinary membership path. Nothing else should ever read `X-Active-Tenant`
 * (or any client-supplied identifier) directly and treat it as
 * authoritative — see that guard's own header comment.
 *
 * Phase 5 W6 (decision P5-D8): `'support-session'` is the second, entirely
 * separate producer — `common/tenant/support-session-context.guard.ts`,
 * which runs BEFORE `TenantContextGuard` and, once it resolves a valid
 * SupportSession, makes `TenantContextGuard` skip its own resolution
 * entirely (see that guard's own header comment on why the header/domain/
 * membership-default logic must never run afterward and silently override
 * or reject a session-derived context). A `'support-session'` context
 * never carries `membership` (there is no real `TenantMembership` — the
 * actor is a platform admin, not a tenant member) and instead carries
 * `supportSession`.
 */
export interface TenantContext {
  tenantId: string;
  source:
    | 'membership-header'
    | 'membership-default'
    | 'domain'
    | 'support-session'
    | 'storefront-otp';
  /** Present for the ordinary merchant path; absent for the (future, Phase
   * 9/12) unauthenticated storefront path AND for the support-session path.
   * Carries only `role` — that is all `PermissionsGuard.can()` needs, and
   * it is already loaded (fresh, per request) onto
   * `AuthenticatedUser.memberships` by `JwtStrategy`; no second database
   * lookup is made to populate this. */
  membership?: {
    role: TenantRole;
  };
  /** Present only when `source === 'support-session'`. `grantedPermissions`
   * is the CEILING `PermissionsGuard` checks a route's own
   * `@RequirePermission(...)` against (P5-D8) — it is never itself a grant
   * of tenant authority beyond what the route already requires, and it is
   * never combined with `membership` (a support session is never also a
   * tenant member). */
  supportSession?: {
    id: string;
    grantedPermissions: readonly Permission[];
  };
}

/**
 * Request shape after `JwtAuthGuard` + `TenantContextGuard` have run.
 * `tenantContext` is `undefined` when no tenant could be established
 * (platform-only routes, `@Public()` routes, or a merchant request with no
 * resolvable/authorized tenant) — every guard/handler downstream must treat
 * "no context" as "no tenant access", never as "all tenants" (fail closed).
 */
export interface RequestWithTenantContext {
  tenantContext?: TenantContext;
}
