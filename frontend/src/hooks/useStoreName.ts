import { useQuery } from '@tanstack/react-query'
import { fetchStoreName } from '@/services/api/settings'
import { CATALOG_STALE_TIME_MS } from '@/constants/query'

/**
 * The store name is configured by the
 * store owner in Admin → Settings → Store identity and is what the
 * storefront chrome (header, hero eyebrow, footer) shows to customers.
 *
 * Until an owner changes it the backend returns the saved storeName
 * (bootstrapped to "AB Creations" for this store). This hook additionally
 * guards against the settings endpoint being unavailable — it never
 * returns an empty/undefined name.
 */
export const STORE_NAME_FALLBACK = 'AB Creations'

export function useStoreName(): string {
  const { data } = useQuery({
    queryKey: ['settings', 'storeName'],
    queryFn: fetchStoreName,
    staleTime: CATALOG_STALE_TIME_MS,
  })
  const resolved = data?.trim()
  return resolved && resolved.length > 0 ? resolved : STORE_NAME_FALLBACK
}
