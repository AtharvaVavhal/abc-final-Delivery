import { useCallback, useEffect, useRef, useState } from 'react'
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

/** Master switch for finding the PIN automatically when an address form
 * opens with the PIN empty. The "Use my current location" button works
 * either way; set this to false to go back to tap-only. */
export const AUTO_LOCATE_PIN = true

/**
 * Runs `run` ONCE when a form opens, if `enabled` (decided at that moment —
 * later changes are ignored, so typing never re-triggers it) and location
 * has not been blocked. A browser that already allows location needs no
 * prompt; one that has not decided shows its own permission prompt, which
 * is the consent. Where the Permissions API is unavailable we still try:
 * the prompt, or a refusal, then says everything the customer needs.
 */
export function useAutoLocate(enabled: boolean, run: () => void) {
  const wanted = useRef(enabled)
  const runRef = useRef(run)
  const started = useRef(false)
  useEffect(() => {
    runRef.current = run
  })
  useEffect(() => {
    if (!AUTO_LOCATE_PIN || !wanted.current || started.current || !canUseGeolocation()) return
    started.current = true
    void (async () => {
      try {
        const permission = await navigator.permissions?.query({ name: 'geolocation' })
        if (permission?.state === 'denied') return
      } catch {
        // Not supported (older Safari): fall through and just ask.
      }
      runRef.current()
    })()
  }, [])
}

/**
 * "Use my current location" for the address form. On the button the browser
 * is asked for a position only when `locate()` is called by a tap; forms may
 * also call it once on open via {@link useAutoLocate}.
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
