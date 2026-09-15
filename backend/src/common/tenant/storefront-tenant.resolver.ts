import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { TenantContext } from './tenant-context';
import { assertTenantActive } from './tenant-lifecycle';
import { withPlatformRlsBypass } from './tenant-rls';

/**
 * Phase 4 W7 (decision P4-D2's create-path fix). Resolves the tenant a
 * STOREFRONT (customer-facing, non-membership) write belongs to, for the
 * narrow set of call sites that have no other already-loaded, already-
 * tenant-scoped resource to anchor to (a brand-new empty `Cart`; a
 * customer's file upload before it is attached to anything).
 *
 * `TenantContextGuard` cannot supply this: it resolves tenant context from
 * the caller's `TenantMembership` rows (header override, domain+membership
 * cross-check, single-membership default), and a storefront shopper
 * (`Role.CUSTOMER`) never holds a `TenantMembership` — "a storefront
 * Customer never gets a TenantMembership" (schema.prisma's own `User`
 * comment; P2-D7/P4-D1 defer real customer identity to Phase 9/12). Every
 * OTHER affected create path in this fix (checkout, orders, payments,
 * invoices, coupon usage, reviews, cart items) derives tenantId from an
 * already-loaded parent resource instead — this resolver exists ONLY for
 * the two genuine exceptions where no such anchor exists yet.
 *
 * NEVER trusts a client-supplied tenant identifier — resolution order:
 *   1. Host/subdomain -> `StoreDomain` (the real mechanism, once per-tenant
 *      storefront domains exist — none do in production today). Mirrors
 *      `TenantContextGuard.resolveFromHost`'s own lookup exactly, minus the
 *      membership cross-check (a storefront visitor has no membership to
 *      cross-check against — that check exists for the *merchant* path
 *      only).
 *   2. If host resolution finds nothing (today's actual, single-origin
 *      reality): the most recently created `Tenant` row, if any exist.
 *      This is not an invented customer-auth mechanism — production today
 *      genuinely has exactly one tenant ("Tenant #1"), the same invariant
 *      Phase 1's bootstrap seed and every prior Phase 4 wave have already
 *      relied on (D2/D3, Phase 2b), so "most recent" and "the only one"
 *      are the same tenant there. The "most recent" framing (rather than
 *      requiring the count to be exactly one) exists so this resolver
 *      degrades gracefully in a multi-tenant dev/test environment — many
 *      unrelated ad-hoc tenants created by other fixtures/tests must
 *      never turn an otherwise-normal storefront write into a hard
 *      failure — without weakening the production invariant it is
 *      actually built on. Real host-based resolution (Phase 5+, once
 *      per-tenant storefront domains exist) supersedes this step entirely.
 *   3. Otherwise (no `Tenant` row exists at all): throw. There is
 *      genuinely nothing to attribute this request to.
 */
@Injectable()
export class StorefrontTenantResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolveTenantId(hostname: string | undefined): Promise<string> {
    let tenantId: string | undefined;

    if (hostname) {
      const domain = await withPlatformRlsBypass(this.prisma, (tx) =>
        tx.storeDomain.findUnique({
          where: { hostname },
          select: { store: { select: { tenantId: true } } },
        }),
      );
      if (domain) {
        tenantId = domain.store.tenantId;
      }
    }

    if (!tenantId) {
      // Same platform-scoped case as the host lookup above: no tenant is
      // known yet, so FORCE RLS would hide every Tenant row without the
      // bypass GUC. The fallback is the single-origin / single-tenant
      // path this resolver's header already documents.
      const mostRecent = await withPlatformRlsBypass(this.prisma, (tx) =>
        tx.tenant.findFirst({
          select: { id: true },
          orderBy: { createdAt: 'desc' },
        }),
      );
      tenantId = mostRecent?.id;
    }

    if (!tenantId) {
      throw new ConflictException(
        'Unable to determine which store this request belongs to',
      );
    }

    // Phase 5 W4 (SaaS Master Plan §11) — the actual storefront enforcement
    // point: a shopper never goes through TenantContextGuard's resolution
    // branches (no TenantMembership), so TenantLifecycleGuard never sees
    // them either. This is the one place a brand-new cart/upload's tenant
    // is genuinely resolved from scratch, so it's the one place to block.
    await assertTenantActive(
      this.prisma,
      tenantId,
      'This store is currently unavailable',
    );
    return tenantId;
  }

  /**
   * Convenience wrapper for controllers on routes reachable by BOTH a
   * merchant (has `request.tenantContext`, set by `TenantContextGuard`)
   * and a plain shopper (never does — no `TenantMembership` to resolve
   * one from). Prefers the already-resolved merchant context — no
   * redundant lookup, and no risk of it ever disagreeing with what
   * `TenantContextGuard` already determined — and falls back to
   * `resolveTenantId` only when no context exists.
   */
  async resolveActiveTenantId(
    existingContext: TenantContext | undefined,
    hostname: string | undefined,
  ): Promise<string> {
    if (existingContext) {
      return existingContext.tenantId;
    }
    return this.resolveTenantId(hostname);
  }
}
