import { useQuery } from '@tanstack/react-query'
import { fetchStorefrontPublicSettings } from '@/services/api/settings'
import { getStorefrontShell, STOREFRONT_SHELL_GENERATED_AT_MS } from '@/generated/storefront-shell'

export const STOREFRONT_PUBLIC_SETTINGS_QUERY_KEY = ['settings', 'storefront-public'] as const

/**
 * Snapshot paints the first viewport. Settings then always refetch so a
 * Store Admin logo/announcement/seller-identity save is not stuck behind
 * the 5-minute catalog staleTime or a rebuilt snapshot.
 */
export const STOREFRONT_SETTINGS_QUERY = {
  staleTime: 0,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
  refetchOnMount: 'always' as const,
} as const

/**
 * One public settings read for storefront chrome + homepage content.
 * Header, announcement bar, footer, WhatsApp, and HomePage all share this
 * cache so the landing page does not fire a request per setting key.
 *
 * `initialData` is the build-time public snapshot so the first viewport
 * can render real AB Creations chrome without waiting on Postgres.
 */
export function useStorefrontPublicSettings() {
  const snapshot = getStorefrontShell()
  return useQuery({
    queryKey: STOREFRONT_PUBLIC_SETTINGS_QUERY_KEY,
    queryFn: fetchStorefrontPublicSettings,
    ...STOREFRONT_SETTINGS_QUERY,
    initialData: snapshot?.settings,
    initialDataUpdatedAt: snapshot ? STOREFRONT_SHELL_GENERATED_AT_MS : undefined,
  })
}
