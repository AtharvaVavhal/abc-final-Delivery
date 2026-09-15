import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Layers, X } from 'lucide-react'
import { Header } from './Header'
import { Footer } from './Footer'
import { AnnouncementBar } from '@/components/layout/AnnouncementBar'
import { LeftNavSidebar } from '@/components/layout/LeftNavSidebar'
import { ToastProvider } from '@/components/ui/toast/ToastProvider'
import { WhatsAppButton } from '@/components/ui/WhatsAppButton'
import { cn } from '@/utils/cn'
import styles from './RootLayout.module.css'

export function RootLayout() {
  const location = useLocation()
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  // Focused flow pages where full-width layout is preferred
  const isFocusedPage =
    location.pathname.startsWith('/checkout') ||
    location.pathname.startsWith('/login') ||
    location.pathname.startsWith('/register') ||
    location.pathname.startsWith('/forgot-password') ||
    location.pathname.startsWith('/reset-password') ||
    location.pathname.includes('/invoice')

  return (
    <ToastProvider>
      <div className={styles.shell}>
        <a href="#main-content" className={styles.skipLink}>
          Skip to main content
        </a>
        <AnnouncementBar />
        <Header />

        {isFocusedPage ? (
          <main id="main-content" className={styles.main} tabIndex={-1}>
            <Outlet />
          </main>
        ) : (
          <div className={styles.storefrontLayout}>
            {/* Desktop Left Navigation Sidebar */}
            <aside className={styles.desktopSidebar} aria-label="Store navigation">
              <div className={styles.stickySidebarWrapper}>
                <LeftNavSidebar />
              </div>
            </aside>

            {/* Mobile Drawer Trigger Tab */}
            <button
              type="button"
              className={styles.mobileSidebarToggle}
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Open products & services navigation"
              aria-expanded={mobileSidebarOpen}
            >
              <Layers size={16} aria-hidden="true" />
              <span>Products &amp; Services</span>
            </button>

            {/* Mobile Drawer Overlay and Drawer */}
            {mobileSidebarOpen && (
              <div
                className={styles.drawerOverlay}
                onClick={() => setMobileSidebarOpen(false)}
                aria-hidden="true"
              />
            )}

            <div
              className={cn(styles.mobileDrawer, mobileSidebarOpen && styles.mobileDrawerOpen)}
              aria-label="Products and services mobile menu"
            >
              <div className={styles.mobileDrawerHeader}>
                <span className={styles.mobileDrawerTitle}>Products &amp; Services</span>
                <button
                  type="button"
                  className={styles.closeDrawerButton}
                  onClick={() => setMobileSidebarOpen(false)}
                  aria-label="Close navigation"
                >
                  <X size={20} aria-hidden="true" />
                </button>
              </div>
              <div className={styles.mobileDrawerBody}>
                <LeftNavSidebar onItemClick={() => setMobileSidebarOpen(false)} />
              </div>
            </div>

            {/* Main content area */}
            <main id="main-content" className={styles.main} tabIndex={-1}>
              <Outlet />
            </main>
          </div>
        )}

        <Footer />
        <WhatsAppButton />
      </div>
    </ToastProvider>
  )
}
