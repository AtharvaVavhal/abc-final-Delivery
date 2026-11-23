import { lazy, Suspense, useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Header } from './Header'
import { AnnouncementBar } from '@/components/layout/AnnouncementBar'
import { LeftNavSidebar } from '@/components/layout/LeftNavSidebar'
import { ToastProvider } from '@/components/ui/toast/ToastProvider'
import { WhatsAppButton } from '@/components/ui/WhatsAppButton'
import { FullPageLoader } from '@/components/ui/FullPageLoader'
import { cn } from '@/utils/cn'
import styles from './RootLayout.module.css'
import { OTP_LOGIN_ENABLED } from '@/features/auth/otpEnabled'
import { ROUTES } from '@/constants/routes'

const Footer = lazy(() =>
  import('./Footer').then((m) => ({ default: m.Footer })),
)

const SIDEBAR_COLLAPSED_KEY = 'storefront-sidebar-collapsed'

function getInitialSidebarCollapsed() {
  try {
    // Collapsed by default: the header already carries the category menu, so
    // the sidebar only opens when the visitor asked for it.
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) !== '0'
  } catch {
    return true
  }
}

export function RootLayout() {
  const location = useLocation()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    getInitialSidebarCollapsed,
  )

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SIDEBAR_COLLAPSED_KEY,
        sidebarCollapsed ? '1' : '0',
      )
    } catch {
      // Storage may be unavailable (private browsing); collapse state just won't persist.
    }
  }, [sidebarCollapsed])

  // OTP gets a full viewport; password/recovery and storefront retain their shell.
  const standaloneLogin =
    OTP_LOGIN_ENABLED &&
    ((location.pathname === ROUTES.LOGIN &&
      new URLSearchParams(location.search).get('method') !== 'password') ||
      location.pathname === ROUTES.REGISTER)
  if (standaloneLogin) {
    return (
      <ToastProvider>
        <main id="main-content" tabIndex={-1}>
          <Suspense fallback={<FullPageLoader label="Loading sign in" />}>
            <Outlet />
          </Suspense>
        </main>
      </ToastProvider>
    )
  }

  return (
    <ToastProvider>
      <div
        className={styles.shell}
        data-sidebar={sidebarCollapsed ? 'collapsed' : 'open'}
      >
        <a href="#main-content" className={styles.skipLink}>
          Skip to main content
        </a>
        <AnnouncementBar />
        <div
          className={cn(styles.body, sidebarCollapsed && styles.bodyCollapsed)}
        >
          <div className={styles.chrome}>
            <Header key={`${location.pathname}${location.search}`} />
          </div>
          <div
            id="global-sidebar"
            className={cn(
              styles.sidebarColumn,
              sidebarCollapsed && styles.sidebarColumnCollapsed,
            )}
            aria-hidden={sidebarCollapsed}
            inert={sidebarCollapsed}
          >
            <div className={styles.sidebarInner}>
              <LeftNavSidebar />
            </div>
          </div>
          <button
            type="button"
            className={cn(
              styles.sidebarToggle,
              sidebarCollapsed && styles.sidebarToggleCollapsed,
            )}
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
            aria-expanded={!sidebarCollapsed}
            aria-controls="global-sidebar"
            aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          >
            {sidebarCollapsed ? (
              <ChevronRight size={16} aria-hidden="true" />
            ) : (
              <ChevronLeft size={16} aria-hidden="true" />
            )}
          </button>
          <main id="main-content" className={styles.main} tabIndex={-1}>
            <Suspense fallback={<FullPageLoader label="Loading page" />}>
              <Outlet />
            </Suspense>
          </main>
        </div>
        <Suspense fallback={null}>
          <Footer />
        </Suspense>
        <WhatsAppButton />
      </div>
    </ToastProvider>
  )
}
