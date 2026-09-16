import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { clearAuth, getAuthState, setAuthenticated, subscribeAuthState } from '@/services/api/authStore'
import { refreshSession } from '@/services/api/client'
import { loginRequest, logoutRequest, registerRequest } from '@/services/api/auth'
import { isAdminSessionRole } from './adminSession'
import { useAdminIdleLogout } from './useAdminIdleLogout'
import { AuthContext, type AuthContextValue } from './authContext'

/**
 * Wraps the module-level authStore (services/api/authStore.ts) for React —
 * the store itself, not this component, is the source of truth, so the
 * axios client's interceptor (which can't call hooks) and every component
 * in the tree always agree on auth state.
 *
 * On mount, silently attempts POST /auth/refresh (BLUEPRINT-v1.2.md §18:
 * "on a full page reload, access token is gone from memory — call
 * /auth/refresh on app bootstrap to silently re-establish the session from
 * the refresh cookie if one exists, or land the user logged-out if not").
 * Routed through the same refreshSession() the interceptor uses, so a
 * refresh already in flight from a failed request is reused rather than
 * firing a second one.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(subscribeAuthState, getAuthState, getAuthState)

  useEffect(() => {
    void refreshSession()
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const result = await loginRequest(email, password)
    setAuthenticated(result.user, result.accessToken)
  }, [])

  const register = useCallback(async (email: string, password: string) => {
    const result = await registerRequest(email, password)
    setAuthenticated(result.user, result.accessToken)
  }, [])

  const logout = useCallback(async () => {
    try {
      await logoutRequest()
    } finally {
      clearAuth()
    }
  }, [])

  useAdminIdleLogout(
    state.status === 'authenticated' && isAdminSessionRole(state.user?.role),
    logout,
  )

  const value = useMemo<AuthContextValue>(
    () => ({ user: state.user, status: state.status, login, register, logout }),
    [state.user, state.status, login, register, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
