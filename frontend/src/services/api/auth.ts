import type { ApiSuccessResponse } from '@/types/api'
import type { AuthTokenResult, UpdateProfilePayload, UserProfileView } from '@/types/auth'
import { apiClient } from './client'

/**
 * Thin wrappers over the auth/users routes this phase covers
 * (backend/src/auth/auth.controller.ts, backend/src/users/users.controller.ts).
 * Each unwraps the {success, data} envelope (§21) and returns just the
 * payload — callers (AuthContext, page components) never touch res.data.data.
 */

export async function registerRequest(
  email: string,
  password: string,
): Promise<AuthTokenResult> {
  const res = await apiClient.post<ApiSuccessResponse<AuthTokenResult>>(
    '/auth/register',
    { email, password },
  )
  return res.data.data
}

export async function loginRequest(
  email: string,
  password: string,
): Promise<AuthTokenResult> {
  const res = await apiClient.post<ApiSuccessResponse<AuthTokenResult>>(
    '/auth/login',
    { email, password },
  )
  return res.data.data
}

/** POST /auth/otp/request — sends an SMS code. 204, no body. Backend returns
 * 404 while the OTP feature flag is off, 400 for a malformed number and 429
 * when a rate limit is hit. */
export async function requestOtpRequest(phone: string): Promise<void> {
  await apiClient.post('/auth/otp/request', { phone })
}

/** POST /auth/otp/verify — verifies the code and starts a customer session
 * (same shape and refresh cookie as password login). */
export async function verifyOtpRequest(phone: string, code: string): Promise<AuthTokenResult> {
  const res = await apiClient.post<ApiSuccessResponse<AuthTokenResult>>('/auth/otp/verify', {
    phone,
    code,
  })
  return res.data.data
}

export async function logoutRequest(): Promise<void> {
  await apiClient.post('/auth/logout')
}

export async function logoutAllRequest(): Promise<void> {
  await apiClient.post('/auth/logout-all')
}

export async function requestPasswordResetRequest(email: string): Promise<void> {
  await apiClient.post('/auth/password-reset/request', { email })
}

export async function confirmPasswordResetRequest(
  token: string,
  newPassword: string,
): Promise<void> {
  await apiClient.post('/auth/password-reset/confirm', { token, newPassword })
}

export async function fetchCurrentUser(): Promise<UserProfileView> {
  const res = await apiClient.get<ApiSuccessResponse<UserProfileView>>('/users/me')
  return res.data.data
}

/** PATCH /users/me — confirmed live (curl) to return the full updated
 * UserProfileView under the normal {success, data} envelope, no `meta`
 * (this isn't a paginated/list response, so ResponseInterceptor doesn't
 * lift anything). */
export async function updateProfile(payload: UpdateProfilePayload): Promise<UserProfileView> {
  const res = await apiClient.patch<ApiSuccessResponse<UserProfileView>>('/users/me', payload)
  return res.data.data
}
