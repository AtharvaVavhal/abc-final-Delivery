import type { ApiSuccessResponse } from '@/types/api'
import type { PostalLookupView } from '@/types/postal'
import { apiClient } from './client'

/**
 * GET /postal-codes/:postalCode — server-proxied PIN-code → City/State
 * lookup. The backend owns the external provider call, the timeout, and
 * the error taxonomy; this is a thin wrapper.
 *
 * `signal` is forwarded to axios so React Query can abort an in-flight
 * lookup when the PIN changes or the component unmounts — the stale-result
 * guard (a late response for an old PIN must never win).
 */
export async function lookupPostalCode(
  postalCode: string,
  signal?: AbortSignal,
): Promise<PostalLookupView> {
  const res = await apiClient.get<ApiSuccessResponse<PostalLookupView>>(
    `/postal-codes/${encodeURIComponent(postalCode)}`,
    { signal },
  )
  return res.data.data
}

/**
 * GET /postal-codes/reverse — the PIN code at the customer's current
 * position ("Use my location"). The coordinates are sent once, rounded and
 * discarded server-side; nothing is stored. The caller feeds the returned
 * PIN into the normal lookup so City/State come from the same source as a
 * typed PIN.
 */
export interface ReverseGeocodeResult {
  postalCode: string
  /** Suggested street (building / house number + road), or null. */
  addressLine1: string | null
  /** Suggested area (neighbourhood / suburb), or null. */
  addressLine2: string | null
}

export async function reverseLookupPostalCode(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<ReverseGeocodeResult> {
  const res = await apiClient.get<ApiSuccessResponse<ReverseGeocodeResult>>(
    '/postal-codes/reverse',
    { params: { lat, lng }, signal },
  )
  return res.data.data
}
