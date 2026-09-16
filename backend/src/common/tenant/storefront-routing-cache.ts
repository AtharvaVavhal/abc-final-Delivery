/**
 * Short-TTL in-process cache of PUBLIC storefront routing metadata only:
 * hostname → { tenantId, storeId }.
 *
 * This is not an authorization cache and not a customer-data cache. It
 * never stores memberships, roles, tokens, cart contents, or settings
 * values. Keys are hostnames (globally unique on `StoreDomain`) so two
 * tenants cannot share an entry. Disabled when `NODE_ENV === 'test'` so
 * e2e fixtures that create a newer tenant (or suspend one) are never
 * served a stale "most recently created" mapping.
 *
 * Invalidated on tenant suspend/resume (`PlatformService`) so a storefront
 * cache hit cannot outlive an ACTIVE → SUSPENDED transition.
 */

export type StorefrontRouting = {
  tenantId: string;
  /** Null when the tenant has no primary Store — catalog/cart still
   * resolve a tenantId; store-owned settings fail closed. */
  storeId: string | null;
};

const TTL_MS = 15_000;

type Entry = { value: StorefrontRouting; expiresAt: number };

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<StorefrontRouting>>();

export function storefrontRoutingCacheEnabled(): boolean {
  return process.env.NODE_ENV !== 'test';
}

export function storefrontRoutingCacheKey(
  hostname: string | undefined,
): string {
  const host = hostname?.trim().toLowerCase() ?? '';
  return host.length > 0 ? host : '__no_host__';
}

export function getCachedStorefrontRouting(
  hostname: string | undefined,
): StorefrontRouting | undefined {
  if (!storefrontRoutingCacheEnabled()) {
    return undefined;
  }
  const key = storefrontRoutingCacheKey(hostname);
  const entry = cache.get(key);
  if (!entry) {
    return undefined;
  }
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

export function rememberStorefrontRouting(
  hostname: string | undefined,
  value: StorefrontRouting,
): void {
  if (!storefrontRoutingCacheEnabled()) {
    return;
  }
  cache.set(storefrontRoutingCacheKey(hostname), {
    value,
    expiresAt: Date.now() + TTL_MS,
  });
}

export function getInflightStorefrontRouting(
  hostname: string | undefined,
): Promise<StorefrontRouting> | undefined {
  if (!storefrontRoutingCacheEnabled()) {
    return undefined;
  }
  return inflight.get(storefrontRoutingCacheKey(hostname));
}

export function setInflightStorefrontRouting(
  hostname: string | undefined,
  pending: Promise<StorefrontRouting>,
): void {
  if (!storefrontRoutingCacheEnabled()) {
    return;
  }
  inflight.set(storefrontRoutingCacheKey(hostname), pending);
}

export function clearInflightStorefrontRouting(
  hostname: string | undefined,
): void {
  inflight.delete(storefrontRoutingCacheKey(hostname));
}

/** Drops every host entry — used after StoreDomain/store/tenant routing
 * configuration changes, including suspend/resume. */
export function clearStorefrontRoutingCache(): void {
  cache.clear();
  inflight.clear();
}
