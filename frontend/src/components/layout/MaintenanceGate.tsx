import type { ReactNode } from 'react'
import { matchPath, useLocation } from 'react-router-dom'
import { useStorefrontPublicSettings } from '@/hooks/useStorefrontPublicSettings'
import { FullPageLoader } from '@/components/ui/FullPageLoader'
import { IllosMaintenancePage } from '@/components/ui/illos-maintenance-page'
import { Seo } from '@/seo/Seo'

export function MaintenanceGate({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  // Use router matching (including trailing slashes and case handling), not
  // startsWith: /administrator and /login-help are still customer routes.
  if (matchPath('/admin/*', pathname) || matchPath('/login', pathname)) {
    return children
  }
  return <StorefrontAvailability>{children}</StorefrontAvailability>
}

function StorefrontAvailability({ children }: { children: ReactNode }) {
  const settings = useStorefrontPublicSettings({ refetchInterval: 30_000 })

  // The chrome snapshot cannot tell us whether maintenance is on now.
  // Do not mount customer pages/queries until the first live check finishes.
  if (!settings.isFetchedAfterMount) {
    return <FullPageLoader label="Checking store availability" />
  }

  if (settings.data?.maintenance_mode || settings.isError) {
    const maintenance = settings.data?.maintenance_mode === true
    return (
      <>
        <Seo
          title={maintenance ? 'Maintenance' : 'Store unavailable'}
          noindex
        />
        <IllosMaintenancePage
          storeName={settings.data?.storeName}
          logoUrl={settings.data?.storeLogo}
          status={maintenance ? undefined : 'Store availability unavailable'}
          title={maintenance ? undefined : 'We couldn’t reach the store.'}
          description={
            maintenance
              ? undefined
              : 'Please check your connection and try again.'
          }
          onRetry={() => {
            void settings.refetch()
          }}
          isChecking={settings.isFetching}
          error={
            maintenance && settings.isError
              ? 'We couldn’t check for updates. Please try again.'
              : undefined
          }
        />
      </>
    )
  }

  return children
}
