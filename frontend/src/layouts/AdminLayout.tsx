import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Link, Outlet } from 'react-router-dom'
import { Menu, Store } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { ROUTES } from '@/constants/routes'
import { LogoutButton } from '@/features/auth/LogoutButton'
import { AdminSidebar } from '@/components/admin/AdminSidebar'
import { FullPageLoader } from '@/components/ui/FullPageLoader'
import styles from './AdminLayout.module.css'

const MAIN_ID = 'admin-main-content'

/**
 * The admin shell. Sits below <AdminRoute> (which keeps the auth/RBAC
 * guard) and replaces the storefront <RootLayout> chrome for every
 * /admin/* route: a persistent sidebar (off-canvas drawer on mobile), a
 * slim topbar with page context + "Back to store", and a single <main>
 * that renders the matched admin page via <Outlet>.
 *
 * This component owns only the shell. It never renders page content and
 * admin page components do not depend on it (their unit tests still render
 * them standalone).
 */
export function AdminLayout() {
  const { user } = useAuth()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  const closeDrawer = useCallback(() => setDrawerOpen(false), [])
  const openDrawer = useCallback(() => setDrawerOpen(true), [])

  // Escape closes the drawer and returns focus to the trigger.
  useEffect(() => {
    if (!drawerOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setDrawerOpen(false)
        menuButtonRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  // Move focus into the drawer when it opens (mobile only — on desktop the
  // sidebar is always present so the class toggle is inert).
  useEffect(() => {
    if (drawerOpen) closeButtonRef.current?.focus()
  }, [drawerOpen])

  return (
    <div className={styles.shell}>
      <a href={`#${MAIN_ID}`} className={styles.skipLink}>
        Skip to main content
      </a>

      <AdminSidebar
        ref={closeButtonRef}
        drawerOpen={drawerOpen}
        onNavigate={closeDrawer}
        onClose={() => {
          closeDrawer()
          menuButtonRef.current?.focus()
        }}
      />

      {drawerOpen && (
        <div className={styles.backdrop} onClick={closeDrawer} aria-hidden="true" />
      )}

      <div className={styles.contentArea}>
        <header className={styles.topbar}>
          <button
            type="button"
            ref={menuButtonRef}
            className={styles.menuButton}
            onClick={openDrawer}
            aria-label="Open admin menu"
            aria-expanded={drawerOpen}
            aria-controls="admin-sidebar-nav"
          >
            <Menu size={20} aria-hidden="true" />
          </button>

          <span className={styles.context}>AB Creations Admin</span>

          <div className={styles.actions}>
            {user?.email && <span className={styles.identity}>{user.email}</span>}
            <Link to={ROUTES.HOME} className={styles.backToStore}>
              <Store size={16} aria-hidden="true" />
              <span>Back to store</span>
            </Link>
            <LogoutButton />
          </div>
        </header>

        <main id={MAIN_ID} className={styles.main} tabIndex={-1}>
          <div className={styles.container}>
            <Suspense fallback={<FullPageLoader label="Loading admin page" />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  )
}
