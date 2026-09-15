import { forwardRef } from 'react'
import { NavLink } from 'react-router-dom'
import { X } from 'lucide-react'
import { cn } from '@/utils/cn'
import { ROUTES } from '@/constants/routes'
import { ADMIN_NAV } from './adminNav'
import styles from './AdminSidebar.module.css'

interface AdminSidebarProps {
  /** Mobile only — whether the off-canvas drawer is showing. Ignored on
   * desktop, where the sidebar is always visible. */
  drawerOpen: boolean
  /** Called after a nav link is activated — closes the mobile drawer. */
  onNavigate: () => void
  /** Called by the in-drawer close button. */
  onClose: () => void
}

/**
 * Admin section navigation. Driven entirely by `ADMIN_NAV` (adminNav.ts) —
 * every entry is a real, existing route. `NavLink` supplies
 * `aria-current="page"` on the active entry for free; the visible active
 * style is layered on top.
 *
 * Rendered as an <aside> landmark. On desktop it is a persistent column;
 * on mobile it becomes an off-canvas drawer toggled by `drawerOpen` (the
 * close button and backdrop live here / in AdminLayout).
 */
export const AdminSidebar = forwardRef<HTMLButtonElement, AdminSidebarProps>(
  function AdminSidebar({ drawerOpen, onNavigate, onClose }, closeButtonRef) {
    return (
      <aside
        className={cn(styles.sidebar, drawerOpen && styles.open)}
        aria-label="Admin"
      >
        <div className={styles.head}>
          <NavLink
            to={ROUTES.ADMIN_DASHBOARD}
            end
            className={styles.brand}
            onClick={onNavigate}
          >
            AB Creations <span className={styles.brandTag}>Admin</span>
          </NavLink>
          {/* Only meaningful while the mobile drawer is open — on desktop
              the sidebar is persistent and there is nothing to close. */}
          {drawerOpen && (
            <button
              type="button"
              className={styles.closeButton}
              onClick={onClose}
              aria-label="Close admin menu"
              ref={closeButtonRef}
            >
              <X size={20} aria-hidden="true" />
            </button>
          )}
        </div>

        <nav id="admin-sidebar-nav" className={styles.nav} aria-label="Admin sections">
          {ADMIN_NAV.map((group) => (
            <div key={group.label} className={styles.group}>
              <p className={styles.groupLabel}>{group.label}</p>
              <ul className={styles.list}>
                {group.items.map((item) => {
                  const Icon = item.icon
                  return (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.end}
                        onClick={onNavigate}
                        className={({ isActive }) =>
                          cn(styles.link, isActive && styles.linkActive)
                        }
                      >
                        <Icon size={18} aria-hidden="true" className={styles.icon} />
                        <span>{item.label}</span>
                      </NavLink>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
    )
  },
)
