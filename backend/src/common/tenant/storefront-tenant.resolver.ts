import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { TenantContext } from './tenant-context';
import { throwIfTenantSuspended } from './tenant-lifecycle';
import { withPlatformRlsBypass } from './tenant-rls';
import { resolvePrimaryStoreId } from './primary-store';
import {
  clearInflightStorefrontRouting,
  getCachedStorefrontRouting,
  getInflightStorefrontRouting,
  rememberStorefrontRouting,
  setInflightStorefrontRouting,
  type StorefrontRouting,
} from './storefront-routing-cache';

export type StorefrontStoreContext = {
  tenantId: string;
  storeId: string;
};

export type { StorefrontRouting };

const STOREFRONT_UNAVAILABLE = 'This store is currently unavailable';
const STOREFRONT_UNRESOLVED =
  'Unable to determine which store this request belongs to';
const STOREFRONT_NO_PRIMARY_STORE =
  'This tenant has no primary store configured';

/** Remote-Postgres interactive-transaction budget: one lookup, not four. */
const LOOKUP_TX_TIMEOUT_MS = 20_000;
const LOOKUP_TX_MAX_WAIT_MS = 10_000;

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
 *
 * Host/tenant/status/primary-store used to be four sequential interactive
 * transactions (each BEGIN + SET LOCAL + query + COMMIT against a remote
 * Postgres). They now share one `withPlatformRlsBypass` transaction and a
 * single parameterized SQL statement. `tenantId`+`storeId` (routing only)
 * may be reused for a short TTL from the in-process host cache; status is
 * still loaded on every cache miss, and the cache is cleared on
 * suspend/resume. Never caches customer data or authorization results.
 */
@Injectable()
export class StorefrontTenantResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolveTenantId(hostname: string | undefined): Promise<string> {
    const routing = await this.resolveRouting(hostname);
    return routing.tenantId;
  }

  /**
   * Same resolution as `resolveTenantId`, plus the tenant's primary
   * `Store.id`, so public settings can read `StoreSetting` without a
   * second `resolvePrimaryStoreId` round-trip.
   */
  async resolveStorefront(
    hostname: string | undefined,
  ): Promise<StorefrontStoreContext> {
    const routing = await this.resolveRouting(hostname);
    if (!routing.storeId) {
      throw new NotFoundException(STOREFRONT_NO_PRIMARY_STORE);
    }
    return { tenantId: routing.tenantId, storeId: routing.storeId };
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

  async resolveActiveStorefront(
    existingContext: TenantContext | undefined,
    hostname: string | undefined,
  ): Promise<StorefrontStoreContext> {
    if (existingContext) {
      const storeId = await resolvePrimaryStoreId(
        this.prisma,
        existingContext.tenantId,
      );
      return { tenantId: existingContext.tenantId, storeId };
    }
    return this.resolveStorefront(hostname);
  }

  private async resolveRouting(
    hostname: string | undefined,
  ): Promise<StorefrontRouting> {
    const cached = getCachedStorefrontRouting(hostname);
    if (cached) {
      return cached;
    }

    const pending = getInflightStorefrontRouting(hostname);
    if (pending) {
      return pending;
    }

    const lookup = this.lookupStorefront(hostname)
      .then((value) => {
        rememberStorefrontRouting(hostname, value);
        return value;
      })
      .finally(() => {
        clearInflightStorefrontRouting(hostname);
      });

    setInflightStorefrontRouting(hostname, lookup);
    return lookup;
  }

  private async lookupStorefront(
    hostname: string | undefined,
  ): Promise<StorefrontRouting> {
    const host = hostname ?? '';
    const row = await withPlatformRlsBypass(
      this.prisma,
      async (tx) => {
        // One statement after SET LOCAL so a remote Postgres does not pay
        // a round-trip per table. Bypass GUC is already on for this tx;
        // host is a bound parameter, never interpolated.
        const rows = await tx.$queryRaw<
          Array<{
            tenantId: string;
            storeId: string | null;
            status: string | null;
          }>
        >`
          WITH domain_match AS (
            SELECT
              s."tenantId" AS "tenantId",
              CASE WHEN s."isPrimary" THEN s.id ELSE NULL END AS "storeId"
            FROM store_domains d
            INNER JOIN stores s ON s.id = d."storeId"
            WHERE ${host} <> '' AND d.hostname = ${host}
            LIMIT 1
          ),
          fallback_tenant AS (
            SELECT t.id AS "tenantId"
            FROM tenants t
            WHERE NOT EXISTS (SELECT 1 FROM domain_match)
            ORDER BY t."createdAt" DESC
            LIMIT 1
          ),
          resolved_tenant AS (
            SELECT "tenantId", "storeId" FROM domain_match
            UNION ALL
            SELECT ft."tenantId", NULL::text FROM fallback_tenant ft
          )
          SELECT
            rt."tenantId",
            COALESCE(
              rt."storeId",
              (
                SELECT s.id
                FROM stores s
                WHERE s."tenantId" = rt."tenantId" AND s."isPrimary" = true
                LIMIT 1
              )
            ) AS "storeId",
            t.status AS status
          FROM resolved_tenant rt
          INNER JOIN tenants t ON t.id = rt."tenantId"
        `;
        return rows[0] ?? null;
      },
      { maxWait: LOOKUP_TX_MAX_WAIT_MS, timeout: LOOKUP_TX_TIMEOUT_MS },
    );

    if (!row?.tenantId) {
      throw new ConflictException(STOREFRONT_UNRESOLVED);
    }

    throwIfTenantSuspended(row.status, STOREFRONT_UNAVAILABLE);

    return { tenantId: row.tenantId, storeId: row.storeId ?? null };
  }
}
