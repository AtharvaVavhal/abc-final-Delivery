import { useQuery } from '@tanstack/react-query'
import { fetchStoreLogo } from '@/services/api/settings'
import { CATALOG_STALE_TIME_MS } from '@/constants/query'

/** Bundled mark in `frontend/public/catalog/logo.png`. Used until an admin
 * uploads a replacement in Settings, and whenever the public setting is
 * blank or unreachable. */
export const STORE_LOGO_FALLBACK = '/catalog/logo.png'

export function useStoreLogo(): string {
  const { data } = useQuery({
    queryKey: ['settings', 'storeLogo'],
    queryFn: fetchStoreLogo,
    staleTime: CATALOG_STALE_TIME_MS,
  })
  const resolved = data?.trim()
  return resolved && resolved.length > 0 ? resolved : STORE_LOGO_FALLBACK
}
