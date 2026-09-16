import { NavLink, useLocation } from 'react-router-dom'
import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, Menu, Search, ShoppingBag, User, X } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useCart } from '@/hooks/useCart'
import { useCategoryTree } from '@/hooks/useCategoryTree'
import { STORE_NAME_FALLBACK, useStoreName } from '@/hooks/useStoreName'
import { STORE_LOGO_FALLBACK, useStoreLogo } from '@/hooks/useStoreLogo'
import { ROUTES } from '@/constants/routes'
import { cn } from '@/utils/cn'
import { LogoutButton } from '@/features/auth/LogoutButton'
import { CurrencySelector } from '@/components/layout/CurrencySelector'
import { CategoryAccordion } from '@/components/layout/CategoryAccordion'
import type { CategoryTreeNode } from '@/types/catalog'
import { sortCategoryTree } from '@/features/catalog/categoryNavOrder'
import { HeaderSearch } from './HeaderSearch'
import styles from './Header.module.css'

/** Keep long group names from colliding with brand and cart icons. */
const VISIBLE_CATEGORY_LIMIT = 3
/** Pointer can cross the trigger → panel gap without the menu unmounting. */
const MENU_CLOSE_MS = 180

function brandLabel(storeName: string): string {
  return storeName.trim().toLowerCase() === 'printforge' ? STORE_NAME_FALLBACK : storeName
}

function categoryMatches(node: CategoryTreeNode, param: string): boolean {
  if (!param) return false
  const target = param.toLowerCase()
  if (node.id.toLowerCase() === target || node.slug.toLowerCase() === target) return true
  return node.children.some((child) => categoryMatches(child, target))
}

function categoryHref(id: string): string {
  return `${ROUTES.PRODUCTS}?categoryId=${encodeURIComponent(id)}`
}

export function Header() {
  const { user, status } = useAuth()
  const { data: cart } = useCart()
  const { data: categoryTree, isLoading: treeLoading } = useCategoryTree()
  const storeName = brandLabel(useStoreName())
  const storeLogo = useStoreLogo()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [openGroupId, setOpenGroupId] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const location = useLocation()
  const searchPanelId = useId()
  const moreMenuId = useId()
  const moreRef = useRef<HTMLLIElement>(null)
  const searchWrapRef = useRef<HTMLDivElement>(null)
  const searchPanelRef = useRef<HTMLDivElement>(null)
  const menuCloseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const cancelMenuClose = () => {
    if (menuCloseTimer.current) {
      clearTimeout(menuCloseTimer.current)
      menuCloseTimer.current = undefined
    }
  }

  const openCategoryMenu = (id: string) => {
    cancelMenuClose()
    setMoreOpen(false)
    setOpenGroupId(id)
  }

  const scheduleCloseCategoryMenu = (id: string) => {
    cancelMenuClose()
    menuCloseTimer.current = setTimeout(() => {
      setOpenGroupId((current) => (current === id ? null : current))
      menuCloseTimer.current = undefined
    }, MENU_CLOSE_MS)
  }

  const searchParams = new URLSearchParams(location.search)
  const currentCategoryParam = (searchParams.get('category') || searchParams.get('categoryId') || '')
    .toLowerCase()
    .trim()
  const isHome = location.pathname === ROUTES.HOME

  const onAuthPage =
    location.pathname === ROUTES.LOGIN || location.pathname === ROUTES.REGISTER
  const registerState = onAuthPage ? undefined : { from: location }

  const categories = sortCategoryTree(categoryTree ?? [])
  const visibleCategories = categories.slice(0, VISIBLE_CATEGORY_LIMIT)
  const overflowCategories = categories.slice(VISIBLE_CATEGORY_LIMIT)
  const isAuthenticated = status === 'authenticated' && Boolean(user)
  const cartCount = cart?.itemCount ?? 0
  const accountHref = isAuthenticated ? ROUTES.ACCOUNT : ROUTES.LOGIN
  const accountLabel = isAuthenticated ? 'Account' : 'Log in'

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setMoreOpen(false)
      setOpenGroupId(null)
      setSearchOpen(false)
      setMobileOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (moreRef.current && !moreRef.current.contains(target)) setMoreOpen(false)
      const inSearch =
        searchWrapRef.current?.contains(target) || searchPanelRef.current?.contains(target)
      if (!inSearch) setSearchOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [])

  useEffect(() => () => cancelMenuClose(), [])

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <div className={styles.brandCluster}>
          <button
            className={styles.mobileMenuButton}
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            type="button"
          >
            <Menu size={22} strokeWidth={1.5} aria-hidden="true" />
          </button>

          <NavLink to={ROUTES.HOME} className={styles.brand} aria-label={`${storeName} home`}>
            <img
              src={storeLogo || STORE_LOGO_FALLBACK}
              alt=""
              className={styles.brandLogo}
              width={188}
              height={44}
              decoding="async"
            />
          </NavLink>
        </div>

        <nav
          className={cn(styles.navDesktop, (openGroupId || moreOpen) && styles.navDesktopRaised)}
          aria-label="Product categories"
        >
          <ul className={styles.navList}>
            <li>
              <NavLink
                to={ROUTES.HOME}
                end
                className={cn(styles.navLink, isHome && styles.navLinkActive)}
              >
                Home
              </NavLink>
            </li>
            {treeLoading ? (
              <li className={styles.navSkeletonItem} aria-hidden="true">
                <div className={styles.navSkeleton} />
              </li>
            ) : (
              <>
                {visibleCategories.map((category) => {
                  const isActive = categoryMatches(category, currentCategoryParam)
                  if (category.children.length === 0) {
                    return (
                      <li key={category.id}>
                        <NavLink
                          to={categoryHref(category.id)}
                          className={cn(styles.navLink, isActive && styles.navLinkActive)}
                        >
                          {category.name}
                        </NavLink>
                      </li>
                    )
                  }

                  const menuOpen = openGroupId === category.id
                  return (
                    <li
                      key={category.id}
                      className={cn(styles.moreItem, menuOpen && styles.moreItemOpen)}
                      onMouseEnter={() => openCategoryMenu(category.id)}
                      onMouseLeave={() => scheduleCloseCategoryMenu(category.id)}
                    >
                      <button
                        type="button"
                        className={cn(styles.navLink, styles.moreBtn, isActive && styles.navLinkActive)}
                        onClick={() => openCategoryMenu(category.id)}
                        aria-expanded={menuOpen}
                        aria-haspopup="true"
                        aria-controls={`${category.id}-menu`}
                      >
                        <span>{category.name}</span>
                        <ChevronDown
                          size={14}
                          strokeWidth={1.75}
                          className={cn(styles.moreChevron, menuOpen && styles.moreChevronOpen)}
                          aria-hidden="true"
                        />
                      </button>
                      {menuOpen && (
                        <div className={styles.moreMenu} id={`${category.id}-menu`} role="menu">
                          {category.children.map((child) => (
                            <NavLink
                              key={child.id}
                              to={categoryHref(child.id)}
                              className={styles.moreLink}
                              onClick={() => setOpenGroupId(null)}
                              role="menuitem"
                            >
                              {child.name}
                            </NavLink>
                          ))}
                        </div>
                      )}
                    </li>
                  )
                })}
                {overflowCategories.length > 0 && (
                  <li className={cn(styles.moreItem, moreOpen && styles.moreItemOpen)} ref={moreRef}>
                    <button
                      type="button"
                      className={cn(styles.navLink, styles.moreBtn, moreOpen && styles.navLinkActive)}
                      onClick={() => setMoreOpen((open) => !open)}
                      aria-expanded={moreOpen}
                      aria-haspopup="true"
                      aria-controls={moreMenuId}
                    >
                      <span>More</span>
                      <ChevronDown
                        size={14}
                        strokeWidth={1.75}
                        className={cn(styles.moreChevron, moreOpen && styles.moreChevronOpen)}
                        aria-hidden="true"
                      />
                    </button>
                    {moreOpen && (
                      <div className={cn(styles.moreMenu, styles.moreMenuEnd)} id={moreMenuId} role="menu">
                        {overflowCategories.map((category) => (
                          <NavLink
                            key={category.id}
                            to={categoryHref(category.id)}
                            className={styles.moreLink}
                            onClick={() => setMoreOpen(false)}
                            role="menuitem"
                          >
                            {category.name}
                          </NavLink>
                        ))}
                      </div>
                    )}
                  </li>
                )}
              </>
            )}
          </ul>
        </nav>

        <div className={styles.actions}>
          <CurrencySelector />

          {user?.role === 'ADMIN' && (
            <NavLink to={ROUTES.ADMIN_DASHBOARD} className={styles.adminLink}>
              Admin
            </NavLink>
          )}

          <div ref={searchWrapRef}>
            <button
              type="button"
              className={cn(styles.iconButton, searchOpen && styles.iconButtonActive)}
              aria-label="Search"
              aria-expanded={searchOpen}
              aria-controls={searchPanelId}
              onClick={() => {
                setSearchOpen((open) => !open)
                setMoreOpen(false)
              }}
            >
              <Search size={20} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </div>

          <NavLink
            to={accountHref}
            className={cn(styles.iconButton, styles.headerBarAction)}
            aria-label={accountLabel}
          >
            <User size={20} strokeWidth={1.5} aria-hidden="true" />
          </NavLink>

          <NavLink
            to={ROUTES.CART}
            className={styles.iconButton}
            aria-label={`Cart${cartCount > 0 ? `, ${cartCount} item${cartCount === 1 ? '' : 's'}` : ''}`}
          >
            <ShoppingBag size={20} strokeWidth={1.5} aria-hidden="true" />
            {cartCount > 0 && <span className={styles.cartBadge}>{cartCount}</span>}
          </NavLink>
        </div>
      </div>

      <div
        id={searchPanelId}
        ref={searchPanelRef}
        className={cn(styles.searchPanel, searchOpen && styles.searchPanelOpen)}
        hidden={!searchOpen}
      >
        <div className={styles.searchPanelInner}>
          <HeaderSearch variant="bar" active={searchOpen} onSubmitted={() => setSearchOpen(false)} />
        </div>
      </div>

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
        aria-label="Mobile categories"
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
              type="button"
            >
              <X size={20} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </div>

          <NavLink to={ROUTES.HOME} className={styles.mobileAllProducts} onClick={() => setMobileOpen(false)}>
            Home
          </NavLink>
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
