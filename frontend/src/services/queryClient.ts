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
 * Single QueryClient for the app. Default `refetchOnWindowFocus: false` so
 * public catalog/settings do not re-hit the public-read throttle on tab
 * focus. Cart (§18) opts back in with `staleTime: 0, refetchOnWindowFocus:
 * true` on its own query. One retry softens transient network blips
 * without looping on 4xx (including 429).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetryQuery,
      refetchOnWindowFocus: false,
    },
  },
})
