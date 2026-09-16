import { useQuery } from '@tanstack/react-query'
import { fetchStorefrontPublicSettings } from '@/services/api/settings'
import { STOREFRONT_PUBLIC_QUERY } from '@/constants/query'
import { STOREFRONT_PUBLIC_SETTINGS_QUERY_KEY } from './useStorefrontPublicSettings'
import { getStorefrontShell } from '@/generated/storefront-shell'

export function useHomepageSettings() {
  const snapshot = getStorefrontShell()
  return useQuery({
    queryKey: STOREFRONT_PUBLIC_SETTINGS_QUERY_KEY,
    queryFn: fetchStorefrontPublicSettings,
    ...STOREFRONT_PUBLIC_QUERY,
    initialData: snapshot?.settings,
    initialDataUpdatedAt: snapshot ? Date.now() : undefined,
    select: (data) => data.homepage,
  })
}
