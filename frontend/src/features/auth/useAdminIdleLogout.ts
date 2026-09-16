import { useEffect } from 'react'
import { ADMIN_IDLE_LOGOUT_MS } from './adminSession'

const ACTIVITY_EVENTS = [
  'mousedown',
  'mousemove',
  'keydown',
  'scroll',
  'touchstart',
  'click',
] as const

/**
 * Signs an admin out after 15 minutes with no pointer/keyboard activity.
 * Also checks on tab-focus: background timer throttling must not leave an
 * admin panel unlocked after the operator has walked away.
 * Customers never enable this — pass `enabled: false`.
 */
export function useAdminIdleLogout(enabled: boolean, onIdle: () => void) {
  useEffect(() => {
    if (!enabled) return

    let lastActivity = Date.now()
    let timer = 0
    let signedOut = false

    const fire = () => {
      if (signedOut) return
      signedOut = true
      window.clearTimeout(timer)
      onIdle()
    }

    const arm = () => {
      window.clearTimeout(timer)
      const remaining = ADMIN_IDLE_LOGOUT_MS - (Date.now() - lastActivity)
      timer = window.setTimeout(() => {
        if (Date.now() - lastActivity >= ADMIN_IDLE_LOGOUT_MS) fire()
      }, Math.max(0, remaining))
    }

    const bump = () => {
      if (signedOut) return
      lastActivity = Date.now()
      arm()
    }

    const maybeIdle = () => {
      if (Date.now() - lastActivity >= ADMIN_IDLE_LOGOUT_MS) fire()
      else arm()
    }

    arm()
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, bump, { passive: true })
    }
    document.addEventListener('visibilitychange', maybeIdle)
    window.addEventListener('focus', maybeIdle)

    return () => {
      window.clearTimeout(timer)
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, bump)
      }
      document.removeEventListener('visibilitychange', maybeIdle)
      window.removeEventListener('focus', maybeIdle)
    }
  }, [enabled, onIdle])
}
