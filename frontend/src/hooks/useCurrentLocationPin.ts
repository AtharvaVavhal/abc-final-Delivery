import { useCallback, useState } from 'react'
import { reverseLookupPostalCode } from '@/services/api/postal'
import { getApiErrorMessage } from '@/utils/apiError'

export type CurrentLocationStatus = 'idle' | 'locating' | 'error'

const MANUAL_HINT = 'Enter your PIN code manually.'

function geolocationErrorMessage(error: GeolocationPositionError): string {
  // 1 = PERMISSION_DENIED. Anything else (unavailable, timeout) is a
  // device/network problem, not a refusal.
  return error.code === 1
    ? `Location access was blocked. ${MANUAL_HINT}`
    : `We couldn't get your location. ${MANUAL_HINT}`
}

/** Whether this browser can be asked for a position at all. */
export function canUseGeolocation(): boolean {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator
}

/**
 * "Use my current location" for the address form. The browser is asked for
 * a position ONLY when `locate()` is called (a button tap) — never on page
 * load — so the permission prompt always follows an explicit user action.
 *
 * The position is sent once to the backend to find a PIN code and is not
 * kept anywhere in app state: only the resulting PIN is handed back.
 */
export function useCurrentLocationPin() {
  const [status, setStatus] = useState<CurrentLocationStatus>('idle')
  const [message, setMessage] = useState<string | null>(null)

  const locate = useCallback(async (): Promise<string | null> => {
    if (!canUseGeolocation()) {
      setStatus('error')
      setMessage(`Your browser can't share location. ${MANUAL_HINT}`)
      return null
    }
    setStatus('locating')
    setMessage(null)
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          // A neighbourhood-level fix is enough to find a PIN code, and
          // it is faster and lighter on battery than a GPS lock.
          enableHighAccuracy: false,
          timeout: 10_000,
          maximumAge: 60_000,
        })
      })
      const { postalCode } = await reverseLookupPostalCode(
        position.coords.latitude,
        position.coords.longitude,
      )
      setStatus('idle')
      return postalCode
    } catch (error) {
      setStatus('error')
      if (typeof error === 'object' && error !== null && 'code' in error && 'PERMISSION_DENIED' in error) {
        setMessage(geolocationErrorMessage(error as GeolocationPositionError))
      } else {
        setMessage(getApiErrorMessage(error))
      }
      return null
    }
  }, [])

  return { status, message, locate }
}
