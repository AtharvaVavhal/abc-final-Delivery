import { useQuery } from '@tanstack/react-query'
import { fetchStorefrontPublicSettings } from '@/services/api/settings'
import { CATALOG_STALE_TIME_MS } from '@/constants/query'
import { STOREFRONT_PUBLIC_SETTINGS_QUERY_KEY } from './useStorefrontPublicSettings'

export function useHomepageSettings() {
  return useQuery({
    queryKey: STOREFRONT_PUBLIC_SETTINGS_QUERY_KEY,
    queryFn: fetchStorefrontPublicSettings,
    staleTime: CATALOG_STALE_TIME_MS,
    select: (data) => data.homepage,
  })
}
