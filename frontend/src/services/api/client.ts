import axios, { type InternalAxiosRequestConfig } from 'axios'
import type { ApiSuccessResponse } from '@/types/api'
import type { AuthTokenResult } from '@/types/auth'
import { clearAuth, getAccessToken, setAuthenticated } from './authStore'

declare module 'axios' {
  interface InternalAxiosRequestConfig {
    /** Marks a request that has already gone through one refresh-and-retry
     * cycle, so a second 401 on the same request fails instead of looping. */
    _retry?: boolean
  }
}

export function resolveApiBaseUrl(rawUrl?: string): string {
  const trimmed = rawUrl?.trim().replace(/\/+$/, '')
  if (!trimmed) {
    return '/api/v1'
  }
  if (!trimmed.endsWith('/api/v1')) {
    return `${trimmed}/api/v1`
  }
  return trimmed
}

export const API_BASE_URL = resolveApiBaseUrl(import.meta.env.VITE_API_BASE_URL)

const REFRESH_PATH = '/auth/refresh'

/**
 * The one axios instance every API call in this app goes through
 * (BLUEPRINT-v1.2.md §18). `withCredentials: true` is required for the
 * HttpOnly refresh cookie to be sent/received on cross-subdomain requests
 * (www.printforge.in <-> api.printforge.in — same registrable domain, so
 * SameSite=Strict still applies, see auth.service.ts's cookie config).
 */
export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
})

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAccessToken()
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`)
  }
  return config
})

let refreshPromise: Promise<string | null> | null = null

/**
 * Performs the actual POST /auth/refresh call via plain axios, NOT
 * `apiClient` — this is what actually guarantees a 401 from the refresh
 * endpoint can never re-enter apiClient's own response interceptor below
 * and recurse. On success, updates the shared authStore so every consumer
 * (this client's request interceptor, AuthContext) sees the new token
 * immediately; on failure, clears auth state — the "logout directly, no
 * recursive refresh attempt" behavior §18 requires.
 */
async function performRefresh(): Promise<string | null> {
  try {
    const res = await axios.post<ApiSuccessResponse<AuthTokenResult>>(
      REFRESH_PATH,
      undefined,
      { baseURL: API_BASE_URL, withCredentials: true },
    )
    const { accessToken, user } = res.data.data
    setAuthenticated(user, accessToken)
    return accessToken
  } catch {
    clearAuth()
    return null
  }
}

/**
 * Exported so AuthContext's bootstrap-on-reload call and this file's 401
 * handler share the exact same in-flight promise — never two parallel
 * refresh calls, whether they're triggered by a failed request or by the
 * app mounting (§18: "every concurrently-failing request awaits that SAME
 * promise, never triggers a second parallel refresh call").
 */
export function refreshSession(): Promise<string | null> {
  refreshPromise ??= performRefresh().finally(() => {
    refreshPromise = null
  })
  return refreshPromise
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    // axios.isAxiosError() (a property check: error.isAxiosError === true),
    // not `error instanceof AxiosError` — the latter can false-negative
    // whenever the error crosses a module boundary that resolved a
    // different instance of the axios package than this file's own import
    // (bundler/test-tooling edge case, not just theoretical — caught by
    // this file's own test suite against axios-mock-adapter).
    if (!axios.isAxiosError(error)) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
    if (!error.config || error.response?.status !== 401) {
      return Promise.reject(error)
    }

    // Defensive: performRefresh() above never calls through apiClient, so
    // this branch shouldn't be reachable in practice — kept in case
    // /auth/refresh is ever called via apiClient directly.
    if (error.config.url?.includes(REFRESH_PATH)) {
      clearAuth()
      return Promise.reject(error)
    }

    if (error.config._retry) {
      return Promise.reject(error)
    }
    error.config._retry = true

    const newToken = await refreshSession()
    if (!newToken) {
      return Promise.reject(error)
    }

    error.config.headers.set('Authorization', `Bearer ${newToken}`)
    return apiClient(error.config)
  },
)
