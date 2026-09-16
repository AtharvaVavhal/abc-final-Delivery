import { useQuery } from '@tanstack/react-query'
import { fetchStorefrontPublicSettings } from '@/services/api/settings'
import {
  STOREFRONT_PUBLIC_SETTINGS_QUERY_KEY,
  STOREFRONT_SETTINGS_QUERY,
} from './useStorefrontPublicSettings'
import { getStorefrontShell, STOREFRONT_SHELL_GENERATED_AT_MS } from '@/generated/storefront-shell'

export function useHomepageSettings() {
  const snapshot = getStorefrontShell()
  return useQuery({
    queryKey: STOREFRONT_PUBLIC_SETTINGS_QUERY_KEY,
    queryFn: fetchStorefrontPublicSettings,
    ...STOREFRONT_SETTINGS_QUERY,
    initialData: snapshot?.settings,
    initialDataUpdatedAt: snapshot ? STOREFRONT_SHELL_GENERATED_AT_MS : undefined,
    select: (data) => data.homepage,
  })
}
