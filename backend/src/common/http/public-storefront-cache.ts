/**
 * Browser/CDN cache for PUBLIC storefront reads (settings, category tree).
 *
 * Tenant safety: responses still go through StorefrontTenantResolver
 * (hostname → store). `Vary: Host` keeps a CDN from mixing two tenants
 * that share a URL path. This is never applied to cart, auth, orders,
 * payments, or admin routes.
 *
 * Short TTL + SWR so Store Admin edits show up without a frontend rebuild.
 * The HTML snapshot is a separate, build-time copy.
 */
export const PUBLIC_STOREFRONT_CACHE_CONTROL =
  'public, max-age=15, stale-while-revalidate=120';
export const PUBLIC_STOREFRONT_CACHE_VARY = 'Host';
