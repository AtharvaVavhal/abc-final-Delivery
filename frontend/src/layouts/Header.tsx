import { NavLink, useLocation } from 'react-router-dom'
import { useState } from 'react'
import { ShoppingCart, Menu, X, User, Package, ShieldCheck, Clock, ChevronDown } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useCart } from '@/hooks/useCart'
import { useCategoryTree } from '@/hooks/useCategoryTree'
import { useStoreName } from '@/hooks/useStoreName'
import { ROUTES } from '@/constants/routes'
import { cn } from '@/utils/cn'
import { LogoutButton } from '@/features/auth/LogoutButton'
import { CurrencySelector } from '@/components/layout/CurrencySelector'
import { CategoryAccordion } from '@/components/layout/CategoryAccordion'
import { HeaderSearch } from './HeaderSearch'
import styles from './Header.module.css'

const UVPIXEL_DIRECT_LINKS = [
  { label: 'All Products', to: ROUTES.PRODUCTS, categoryKey: null },
  { label: 'Business Cards', to: `${ROUTES.PRODUCTS}?category=business-cards`, categoryKey: 'business-cards' },
  { label: 'Logo', to: `${ROUTES.PRODUCTS}?category=logo`, categoryKey: 'logo' },
  { label: 'Mugs', to: `${ROUTES.PRODUCTS}?category=mugs`, categoryKey: 'mugs' },
  { label: 'Name Plates', to: `${ROUTES.PRODUCTS}?category=name-plates`, categoryKey: 'name-plates' },
  { label: 'T-Shirts', to: `${ROUTES.PRODUCTS}?category=t-shirts`, categoryKey: 't-shirts' },
]

export function Header() {
  const { user, status } = useAuth()
  const { data: cart } = useCart()
  const { data: categoryTree, isLoading: treeLoading } = useCategoryTree()
  const storeName = useStoreName()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const location = useLocation()

  // Track active navigation link accurately by URL pathname & search query parameters
  const searchParams = new URLSearchParams(location.search)
  const currentCategoryParam = (searchParams.get('category') || searchParams.get('categoryId') || '').toLowerCase().trim()
  const currentSearchParam = (searchParams.get('search') || '').toLowerCase().trim()
  const isProductsCatalog = location.pathname === ROUTES.PRODUCTS

  const isNavLinkActive = (categoryKey: string | null) => {
    if (!isProductsCatalog) return false
    if (categoryKey === null) {
      return !currentCategoryParam && !currentSearchParam
    }
    const targetKey = categoryKey.toLowerCase()
    return currentCategoryParam === targetKey || (!currentCategoryParam && currentSearchParam === targetKey)
  }

  // "Sign up" carries the current page as `state.from` so a customer who
  // registers from the storefront chrome returns to where they were, the
  // same way ProtectedRoute forwards it (UX-04). Skipped on the auth pages
  // themselves so registration can't resolve back to /login or /register.
  // "Log in" is unchanged.
  const onAuthPage =
    location.pathname === ROUTES.LOGIN || location.pathname === ROUTES.REGISTER
  const registerState = onAuthPage ? undefined : { from: location }

  const categories = categoryTree ?? []
  const isAuthenticated = status === 'authenticated' && Boolean(user)
  const cartCount = cart?.itemCount ?? 0

  return (
    <header className={styles.header}>
      {/* Top row */}
      <div className={styles.topRow}>
        <button
          className={styles.mobileMenuButton}
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav"
        >
          {mobileOpen ? <X size={24} aria-hidden="true" /> : <Menu size={24} aria-hidden="true" />}
        </button>

        <NavLink to={ROUTES.HOME} className={styles.brand} aria-label={`${storeName} home`}>
          <div className={styles.uvLogoFrame}>
            <span className={styles.brandIcon} aria-hidden="true">
              <span className={styles.uvDiamond}>
                <span className={styles.uvDiamondDot} />
              </span>
            </span>
            <span className={styles.brandText}>{storeName}</span>
          </div>
          <span className={styles.trademark} aria-hidden="true">&reg;</span>
        </NavLink>

        <HeaderSearch variant="bar" />

        {/* Right side actions */}
        <div className={styles.actions}>
          <CurrencySelector />

          <NavLink to={ROUTES.CART} className={styles.cartLink} aria-label={`Cart${cartCount > 0 ? `, ${cartCount} item${cartCount === 1 ? '' : 's'}` : ''}`}>
            <ShoppingCart size={20} aria-hidden="true" />
            {cartCount > 0 && <span className={styles.cartBadge}>{cartCount}</span>}
          </NavLink>

          {/* Auth cluster. Below the 560px breakpoint it collapses into the
              nav drawer (which carries the same actions) so the top row
              never has to squeeze brand + cart + login + sign-up onto one
              line (UX-16). */}
          <div className={styles.authActions}>
            {isAuthenticated ? (
              <>
                {user?.role === 'ADMIN' && (
                  <NavLink to={ROUTES.ADMIN_DASHBOARD} className={styles.navLink}>
                    Admin
                  </NavLink>
                )}
                <NavLink to={ROUTES.ACCOUNT} className={styles.accountLink}>
                  <User size={18} aria-hidden="true" />
                  <span className={styles.accountLabel}>Account</span>
                </NavLink>
                <LogoutButton />
              </>
            ) : status === 'unauthenticated' ? (
              <>
                <NavLink to={ROUTES.LOGIN} className={styles.navLink}>
                  Log in
                </NavLink>
                <NavLink
                  to={ROUTES.REGISTER}
                  state={registerState}
                  className={styles.signUpLink}
                >
                  Sign up
                </NavLink>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {/* Bottom navigation row - Desktop category menu */}
      <nav className={styles.navRowDesktop} aria-label="Product categories">
        <div className={styles.navInnerDesktop}>
          <div className={styles.navCategoriesGroup}>
            {treeLoading ? (
              <div className={styles.navSkeleton} aria-hidden="true" />
            ) : (
              <ul className={styles.uvpixelDirectNav}>
                {UVPIXEL_DIRECT_LINKS.map((link) => {
                  const isActive = isNavLinkActive(link.categoryKey)
                  return (
                    <li key={link.label}>
                      <NavLink
                        to={link.to}
                        className={cn(styles.uvDirectLink, isActive && styles.uvDirectLinkActive)}
                      >
                        {link.label}
                      </NavLink>
                    </li>
                  )
                })}
                {categories.length > 0 && (
                  <li
                    className={styles.moreCategoriesItem}
                    onMouseEnter={() => setMoreOpen(true)}
                    onMouseLeave={() => setMoreOpen(false)}
                  >
                    <button
                      type="button"
                      className={cn(styles.uvDirectLink, styles.moreBtn, moreOpen && styles.uvDirectLinkActive)}
                      onClick={() => setMoreOpen((prev) => !prev)}
                      aria-expanded={moreOpen}
                      aria-haspopup="true"
                    >
                      <span>More Categories</span>
                      <ChevronDown
                        size={14}
                        className={cn(styles.moreChevron, moreOpen && styles.moreChevronOpen)}
                        aria-hidden="true"
                      />
                    </button>
                    {moreOpen && (
                      <div className={styles.moreDropdownMenu} role="menu">
                        <NavLink
                          to={ROUTES.PRODUCTS}
                          className={styles.dropdownCategoryLink}
                          onClick={() => setMoreOpen(false)}
                          role="menuitem"
                        >
                          All Products
                        </NavLink>
                        {categories.map((cat) => (
                          <NavLink
                            key={cat.id}
                            to={`${ROUTES.PRODUCTS}?categoryId=${encodeURIComponent(cat.id)}`}
                            className={styles.dropdownCategoryLink}
                            onClick={() => setMoreOpen(false)}
                            role="menuitem"
                          >
                            {cat.name}
                          </NavLink>
                        ))}
                      </div>
                    )}
                  </li>
                )}
              </ul>
            )}
          </div>
          <div className={styles.navDesktopPerks} aria-label="Studio guarantees">
            <NavLink to={ROUTES.ORDERS} className={styles.perkLink}>
              <Package size={14} className={styles.perkIcon} aria-hidden="true" />
              <span>Track Orders</span>
            </NavLink>
            <span className={styles.perkDivider} aria-hidden="true" />
            <div className={styles.perkItem}>
              <ShieldCheck size={14} className={styles.perkIconAmber} aria-hidden="true" />
              <span>Free Delivery</span>
            </div>
            <span className={styles.perkDivider} aria-hidden="true" />
            <div className={styles.perkItem}>
              <Clock size={14} className={styles.perkIcon} aria-hidden="true" />
              <span>48–72h Turnaround</span>
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile drawer: overlay + panel. Both live inside <header> so they
          share its stacking context — the panel (z-index: dropdown) then
          reliably sits above the overlay (dropdown - 1) and stays
          interactive. */}
      {mobileOpen && (
        <div
          className={cn(styles.drawerOverlay, styles.visible)}
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}
      <nav
        id="mobile-nav"
        className={cn(styles.navRowMobile, mobileOpen && styles.open)}
        aria-label="Categories"
        role="navigation"
        // Any link tap (category, "All products", account) closes the drawer
        // so the customer lands on the new page unobstructed. Covers the
        // recursive CategoryAccordion links too, which have no per-link
        // handler of their own.
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('a')) setMobileOpen(false)
        }}
      >
        <div className={styles.navInnerMobile}>
          <div className={styles.mobileDrawerHead}>
            <span className={styles.mobileDrawerTitle}>Menu</span>
            <button
              className={styles.mobileNavClose}
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
            >
              <X size={24} aria-hidden="true" />
            </button>
          </div>

          <HeaderSearch variant="drawer" onSubmitted={() => setMobileOpen(false)} />

          <NavLink
            to={ROUTES.PRODUCTS}
            className={styles.mobileAllProducts}
            onClick={() => setMobileOpen(false)}
          >
            All products
          </NavLink>
          {treeLoading ? (
            <div className={styles.navSkeleton} aria-hidden="true" />
          ) : (
            <CategoryAccordion categories={categories} />
          )}

          <div className={styles.mobileDrawerAccount}>
            {isAuthenticated ? (
              <>
                <NavLink
                  to={ROUTES.ACCOUNT}
                  className={styles.mobileAccountLink}
                  onClick={() => setMobileOpen(false)}
                >
                  My account
                </NavLink>
                <NavLink
                  to={ROUTES.ORDERS}
                  className={styles.mobileAccountLink}
                  onClick={() => setMobileOpen(false)}
                >
                  My orders
                </NavLink>
                {user?.role === 'ADMIN' && (
                  <NavLink
                    to={ROUTES.ADMIN_DASHBOARD}
                    className={styles.mobileAccountLink}
                    onClick={() => setMobileOpen(false)}
                  >
                    Admin
                  </NavLink>
                )}
                <LogoutButton
                  className={styles.mobileLogout}
                  onAfterLogout={() => setMobileOpen(false)}
                />
              </>
            ) : (
              <>
                <NavLink
                  to={ROUTES.LOGIN}
                  className={styles.mobileAccountLink}
                  onClick={() => setMobileOpen(false)}
                >
                  Log in
                </NavLink>
                <NavLink
                  to={ROUTES.REGISTER}
                  state={registerState}
                  className={styles.mobileAccountLink}
                  onClick={() => setMobileOpen(false)}
                >
                  Create an account
                </NavLink>
              </>
            )}
          </div>
        </div>
      </nav>
    </header>
  )
}
