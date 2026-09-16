import type { ListProductsParams } from '@/types/catalog'

/**
 * Catalog data (categories, products) is public, read-heavy, and changes
 * rarely — a 5-minute staleTime is appropriate. Deliberately NOT the
 * zero-staleTime/refetchOnWindowFocus pattern the cart will need later
 * (§18: cart is `staleTime: 0`, invalidated after every mutation) — that
 * pattern is wrong here and shouldn't be copied.
 */
export const CATALOG_STALE_TIME_MS = 5 * 60 * 1000

/** Shared by homepage CategoryStoryBar / WatchAndBuy / CategoryDiscovery / Featured. */
export const NEWEST_PRODUCTS_QUERY = {
  limit: 100,
  sort: 'newest' as const,
}

/**
 * Homepage rails that show unfiltered newest products reuse one TanStack
 * Query key (and therefore one GET /products). Filtered rails keep their
 * own params. Tenant isolation stays on the request (host), not the cache.
 */
export function storefrontProductListParams(
  params: ListProductsParams,
  displayLimit: number,
): ListProductsParams {
  const isUnfilteredNewest =
    params.sort === 'newest' &&
    params.categoryId == null &&
    params.search == null &&
    params.minPrice == null &&
    params.maxPrice == null &&
    params.minRating == null &&
    params.page == null
  if (isUnfilteredNewest) {
    return NEWEST_PRODUCTS_QUERY
  }
  return { limit: displayLimit, ...params }
}

/** Public catalog/settings should not refetch on tab focus or remount. */
export const STOREFRONT_PUBLIC_QUERY = {
  staleTime: CATALOG_STALE_TIME_MS,
  refetchOnWindowFocus: false,
  refetchOnMount: false,
  refetchOnReconnect: false,
  retryOnMount: false,
} as const
