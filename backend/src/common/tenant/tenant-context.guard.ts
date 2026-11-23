import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../database/prisma.service';
import { AuthenticatedUser } from '../decorators/current-user.decorator';
import { PLATFORM_ONLY_KEY } from '../decorators/platform-only.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { RequestWithTenantContext, TenantContext } from './tenant-context';
import { withPlatformRlsBypass } from './tenant-rls';

export const ACTIVE_TENANT_HEADER = 'x-active-tenant';

/**
 * Resolves `TenantContext` for the merchant path, server-side, on every
 * request (SaaS Master Plan §9; decision D6, docs/saas/DECISIONS.md,
 * resolved 2026-09-07: BOTH host/subdomain resolution and an explicit
 * `X-Active-Tenant` header, header cross-validated against the caller's
 * `ACTIVE` `TenantMembership` rows — no client-supplied identifier is ever
 * trusted by itself, invariant 1).
 *
 * Registered globally, immediately after `JwtAuthGuard` (so `request.user`
 * is already populated) and before `PermissionsGuard` (so it has a context
 * to read). A NestJS guard, not middleware/an interceptor as the Phase 3
 * spec's prose loosely suggested — guards run before interceptors and in a
 * controllable registration order, which is exactly what "resolve context
 * ahead of the permission check" requires; this is a mechanical refinement
 * of the spec's intent, not a different design.
 *
 * Resolution order (D6's "header as an explicit override" rationale):
 *   1. `X-Active-Tenant` header, if present — MUST match one of the
 *      caller's `ACTIVE` memberships, else 403 (never a silent fallback).
 *   2. Host/subdomain resolution (`StoreDomain` lookup) — the long-run
 *      mechanism once per-tenant admin subdomains exist (none do yet); also
 *      cross-validated against the caller's memberships.
 *   3. Convenience default: if the caller has exactly one `ACTIVE`
 *      membership, use it (still the caller's own membership — not a
 *      privilege grant).
 *   4. Otherwise: no context. `PermissionsGuard` then denies any route that
 *      requires a permission (fail closed) — this guard itself does not
 *      403 in this case, since a route with no `@RequirePermission` may
 *      legitimately have no tenant context (e.g. "list my memberships").
 *
 * `@PlatformOnly()` and `@Public()` routes are skipped entirely (mirrors the
 * existing `@Public()` opt-out pattern in `jwt-auth.guard.ts`) — a
 * `SUPER_ADMIN` gets NO tenant context through this guard, preserving
 * frozen invariant 4 (a platform super-admin has no implicit tenant
 * authority; `TenantMembership` is still required for tenant access).
 */
@Injectable()
export class TenantContextGuard {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<
      RequestWithTenantContext & {
        user?: AuthenticatedUser;
        headers: Record<string, string | string[] | undefined>;
        hostname?: string;
      }
    >();

    // Phase 5 W6 (decision P5-D8): `SupportSessionContextGuard` runs before
    // this guard and, when it resolves a valid support session, sets
    // `request.tenantContext` itself. That resolution is authoritative and
    // must never be second-guessed, overridden, or REJECTED by this
    // guard's own header/domain/membership-default logic below — in
    // particular, a client-supplied `X-Active-Tenant` header must not be
    // able to redirect (or 403) a support-session-derived context, since a
    // SUPER_ADMIN using a support session structurally has zero
    // `TenantMembership` rows and the header branch below would otherwise
    // throw a spoof-rejection 403 for every such request. Skip entirely.
    if (request.tenantContext) {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const isPlatformOnly = this.reflector.getAllAndOverride<boolean>(
      PLATFORM_ONLY_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic || isPlatformOnly) {
      return true;
    }

    const user = request.user;
    if (!user) {
      // No authenticated user: JwtAuthGuard already rejects this request
      // for a non-@Public() route before TenantContextGuard runs. Nothing
      // to resolve.
      return true;
    }

    const memberships = user.memberships ?? [];

    const headerValue = request.headers[ACTIVE_TENANT_HEADER];
    const requestedTenantId = Array.isArray(headerValue)
      ? headerValue[0]
      : headerValue;

    if (user.storefront) {
      if (requestedTenantId && requestedTenantId !== user.storefront.tenantId) {
        throw new ForbiddenException(
          'The requested tenant does not match this storefront',
        );
      }
      request.tenantContext = {
        tenantId: user.storefront.tenantId,
        source: 'storefront-otp',
      };
      return true;
    }

    if (requestedTenantId) {
      const membership = memberships.find(
        (m) => m.tenantId === requestedTenantId,
      );
      if (!membership) {
        // Context-spoof attempt: the caller asked for a tenant they do not
        // hold an ACTIVE membership in. Never fall back silently.
        throw new ForbiddenException(
          'The requested tenant does not match an active membership',
        );
      }
      request.tenantContext = {
        tenantId: membership.tenantId,
        source: 'membership-header',
        membership: { role: membership.role },
      };
      return true;
    }

    const domainContext = await this.resolveFromHost(
      request.hostname,
      memberships,
    );
    if (domainContext) {
      request.tenantContext = domainContext;
      return true;
    }

    if (memberships.length === 1) {
      request.tenantContext = {
        tenantId: memberships[0].tenantId,
        source: 'membership-default',
        membership: { role: memberships[0].role },
      };
      return true;
    }

    // No header, no host resolution, zero or multiple memberships: no
    // implicit tenant. request.tenantContext stays undefined (fail closed —
    // PermissionsGuard denies any route that requires a permission).
    return true;
  }

  private async resolveFromHost(
    hostname: string | undefined,
    memberships: AuthenticatedUser['memberships'],
  ): Promise<TenantContext | undefined> {
    if (!hostname || memberships.length === 0) {
      return undefined;
    }
    // Explicitly cross-tenant by design (resolving a tenant FROM a hostname
    // — no tenant is known yet) — a named platform-scoped operation, per
    // the RLS migration's own header comment.
    const domain = await withPlatformRlsBypass(this.prisma, (tx) =>
      tx.storeDomain.findUnique({
        where: { hostname },
        select: { store: { select: { tenantId: true } } },
      }),
    );
    if (!domain) {
      return undefined;
    }
    const membership = memberships.find(
      (m) => m.tenantId === domain.store.tenantId,
    );
    if (!membership) {
      // The host resolves to a real tenant, but the caller has no active
      // membership there — not this caller's tenant. Fall through (do not
      // throw here; the header path is the one that rejects explicitly, a
      // host mismatch just means "not resolvable this way").
      return undefined;
    }
    return {
      tenantId: domain.store.tenantId,
      source: 'domain',
      membership: { role: membership.role },
    };
  }
}
