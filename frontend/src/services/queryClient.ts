import { QueryClient } from '@tanstack/react-query'
import axios from 'axios'

/** Retry once on network/5xx failures; never retry client errors (401/403/404/422/429). */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false
  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return false
    }
  }
  return true
}

/**
 * Single QueryClient for the app. Deliberately no global staleTime/
 * refetchOnWindowFocus override here — the cart resource (§18) will need
 * `staleTime: 0, refetchOnWindowFocus: true` on its own query, and other
 * resources will want their own tuning; a global default here would just
 * fight per-query overrides added later. One retry softens transient
 * network blips without looping on 4xx.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetryQuery,
    },
  },
})
