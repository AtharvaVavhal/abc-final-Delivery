import { useQuery } from '@tanstack/react-query'
import { fetchStorefrontPublicSettings } from '@/services/api/settings'
import { CATALOG_STALE_TIME_MS } from '@/constants/query'

export const STOREFRONT_PUBLIC_SETTINGS_QUERY_KEY = ['settings', 'storefront-public'] as const

/**
 * One public settings read for storefront chrome + homepage content.
 * Header, announcement bar, footer, WhatsApp, and HomePage all share this
 * cache so the landing page does not fire a request per setting key.
 */
export function useStorefrontPublicSettings() {
  return useQuery({
    queryKey: STOREFRONT_PUBLIC_SETTINGS_QUERY_KEY,
    queryFn: fetchStorefrontPublicSettings,
    staleTime: CATALOG_STALE_TIME_MS,
  })
}
