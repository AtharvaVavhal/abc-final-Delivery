import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { PlatformRole, TenantRole } from '@prisma/client';

/**
 * One tenant membership the authenticated User holds, as an identity FACT
 * only. Phase 2a (SaaS Master Plan §8; decision P2-D4): JwtStrategy.validate()
 * loads these fresh from the DB every request (the token is thin). They are
 * NOT an authorization decision — no "active tenant" is selected and nothing
 * reads `memberships` for a permission check yet. Tenant-aware authorization
 * (active-tenant resolution, PermissionsGuard) is Phase 3 (decision P2-D9;
 * D6 deferred).
 */
export interface AuthenticatedMembership {
  tenantId: string;
  role: TenantRole;
}

/**
 * Shape attached to `req.user` by JwtStrategy.validate() after a successful
 * access-token verification. Anything here is looked up fresh from the DB by
 * the strategy on every request — never trusted from the token.
 *
 * Phase 2a additions (identity facts only): `platformRole` (null = not a
 * platform admin) and `memberships`. `role` is the legacy single-tenant role,
 * retained during the dual-read window — it is removed in Phase 4 (decision
 * P2-D10), not now.
 */
export interface AuthenticatedUser {
  id: string;
  email: string | null;
  role: string;
  platformRole: PlatformRole | null;
  memberships: AuthenticatedMembership[];
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ user: AuthenticatedUser }>();
    return request.user;
  },
);
