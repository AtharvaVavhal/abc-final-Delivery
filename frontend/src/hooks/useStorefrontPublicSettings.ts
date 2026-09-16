import { useQuery } from '@tanstack/react-query'
import { fetchStorefrontPublicSettings } from '@/services/api/settings'
import { STOREFRONT_PUBLIC_QUERY } from '@/constants/query'
import { getStorefrontShell } from '@/generated/storefront-shell'

export const STOREFRONT_PUBLIC_SETTINGS_QUERY_KEY = ['settings', 'storefront-public'] as const

/**
 * One public settings read for storefront chrome + homepage content.
 * Header, announcement bar, footer, WhatsApp, and HomePage all share this
 * cache so the landing page does not fire a request per setting key.
 *
 * `initialData` is the build-time public snapshot so the first viewport
 * can render real AB Creations chrome without waiting on Postgres. Treating
 * the snapshot as fresh for `staleTime` avoids a background GET on every
 * mount.
 */
export function useStorefrontPublicSettings() {
  const snapshot = getStorefrontShell()
  return useQuery({
    queryKey: STOREFRONT_PUBLIC_SETTINGS_QUERY_KEY,
    queryFn: fetchStorefrontPublicSettings,
    ...STOREFRONT_PUBLIC_QUERY,
    initialData: snapshot?.settings,
    initialDataUpdatedAt: snapshot ? Date.now() : undefined,
  })
}
