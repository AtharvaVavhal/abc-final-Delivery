/** Idle time after which an ADMIN session signs out. Shopper sessions
 * are not idle-logged-out — they keep the 30-day refresh cookie. */
export const ADMIN_IDLE_LOGOUT_MS = 15 * 60 * 1000

export function isAdminSessionRole(role: string | undefined | null): boolean {
  return role === 'ADMIN'
}
