import type { Location } from 'react-router-dom'
import { ROUTES } from '@/constants/routes'

interface LocationState {
  from?: { pathname?: string; search?: string }
}

/**
 * Where to send the customer after a successful login or registration.
 * `ProtectedRoute` / `AddToCartControls` / `ReviewList` push the attempted
 * location as `state.from`; if present we return there (path + query so a
 * filtered listing or a product page is restored exactly), otherwise the
 * homepage. Login and registration share this so both honor the same flow
 * (UX-04).
 */
export function postAuthDestination(location: Location): string {
  const from = (location.state as LocationState | null)?.from
  if (
    typeof from?.pathname === 'string' &&
    from.pathname.startsWith('/') &&
    !from.pathname.startsWith('//') &&
    !/[\\\s]/.test(from.pathname)
  ) {
    return `${from.pathname}${from.search ?? ''}`
  }
  return ROUTES.HOME
}
