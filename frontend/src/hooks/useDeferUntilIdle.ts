import { useEffect, useState } from 'react'

/**
 * False on the first paint, then true once the browser is idle (or on the
 * next task if requestIdleCallback is missing). Tests skip the wait so
 * below-the-fold queries still resolve in jsdom.
 *
 * Used to keep hero-image bandwidth and first paint free of secondary
 * catalog/video work.
 */
export function useDeferUntilIdle(): boolean {
  const [ready, setReady] = useState(() => import.meta.env.MODE === 'test')

  useEffect(() => {
    if (ready) return

    const arm = () => setReady(true)
    const win = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
      cancelIdleCallback?: (id: number) => void
    }

    if (typeof win.requestIdleCallback === 'function') {
      const id = win.requestIdleCallback(arm, { timeout: 800 })
      return () => win.cancelIdleCallback?.(id)
    }

    const timer = window.setTimeout(arm, 1)
    return () => window.clearTimeout(timer)
  }, [ready])

  return ready
}
