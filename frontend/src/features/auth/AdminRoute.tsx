import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { ROUTES } from '@/constants/routes'
import { Seo } from '@/seo/Seo'
import { FullPageLoader } from '@/components/ui/FullPageLoader'

/**
 * Client-side UX guard only — same disclaimer as ProtectedRoute, every
 * real check happens server-side (RolesGuard, §18/§23). Checks BOTH
 * authentication and role === 'ADMIN' (confirmed live: Role is exactly
 * 'CUSTOMER' | 'ADMIN', backend/src/common/enums/role.enum.ts).
 *
 * An unauthenticated visitor gets ProtectedRoute's usual /login redirect.
 * A logged-in non-admin gets sent to /forbidden instead — a distinct
 * "you're logged in but not authorized" outcome, never the same /login
 * redirect an unauthenticated visitor gets, which would falsely read as
 * "you've been logged out."
 */
export function AdminRoute() {
  const { status, user } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return <FullPageLoader label="Loading admin" />
  }

  if (status === 'unauthenticated') {
    return <Navigate to={ROUTES.LOGIN} replace state={{ from: location }} />
  }

  if (user?.role !== 'ADMIN') {
    return <Navigate to={ROUTES.FORBIDDEN} replace />
  }

  return (
    <>
      {/* Every admin route is private — one noindex covers the whole area
          (individual admin pages don't render their own <Seo>). */}
      <Seo title="Admin" noindex />
      <Outlet />
    </>
  )
}
