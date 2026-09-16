import { useState, useMemo, type FormEvent } from 'react'
import { NavLink, useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { Search, ChevronRight, ChevronDown } from 'lucide-react'
import { useCategoryTree } from '@/hooks/useCategoryTree'
import { useProducts } from '@/hooks/useProducts'
import { ROUTES } from '@/constants/routes'
import { cn } from '@/utils/cn'
import { formatCategoryName } from '@/utils/formatCategoryName'
import { sortCategoryTree } from '@/features/catalog/categoryNavOrder'
import type { CategoryTreeNode } from '@/types/catalog'
import styles from './LeftNavSidebar.module.css'

interface LeftNavSidebarProps {
  onItemClick?: () => void
  className?: string
}

function countForNode(node: CategoryTreeNode): number {
  if (typeof node.productCount === 'number') return node.productCount
  return (node.children ?? []).reduce((sum, child) => sum + countForNode(child), 0)
}

function CategoryProductPreview({
  categoryId,
  enabled,
  onLinkClick,
}: {
  categoryId: string
  enabled: boolean
  onLinkClick: () => void
}) {
  const { data } = useProducts(
    { categoryId, limit: 20, sort: 'newest' },
    { enabled },
  )
  const items = data?.items ?? []
  if (!enabled || items.length === 0) return null

  return (
    <ul className={styles.productList} role="list">
      {items.map((product) => (
        <li key={product.id} className={styles.productItem}>
          <NavLink
            to={`/products/${encodeURIComponent(product.slug)}`}
            className={styles.productLink}
            onClick={onLinkClick}
            title={product.name}
          >
            <span className={styles.productBullet}>•</span>
            <span className={styles.productName}>{product.name}</span>
          </NavLink>
        </li>
      ))}
    </ul>
  )
}

export function LeftNavSidebar({ onItemClick, className }: LeftNavSidebarProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({})

  const { data: categoryTree = [], isLoading: categoriesLoading } = useCategoryTree()
  const orderedTree = useMemo(() => sortCategoryTree(categoryTree), [categoryTree])

  const currentCategoryId = searchParams.get('categoryId')
  const currentCategorySlug = searchParams.get('category')

  function handleSearch(e: FormEvent) {
    e.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) return
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
    navigate(`${ROUTES.PRODUCTS}?search=${encodeURIComponent(trimmed)}`)
    onItemClick?.()
  }

  function handleLinkClick() {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
    onItemClick?.()
  }

  function toggleCategory(catId: string) {
    setOpenCategories((prev) => ({
      ...prev,
      [catId]: !prev[catId],
    }))
  }

  return (
    <aside className={cn(styles.sidebar, className)} aria-label="Products and services navigation">
      {/* Search Bar */}
      <form onSubmit={handleSearch} className={styles.searchContainer} role="search">
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search Products/Services"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search Products/Services"
        />
        <button type="submit" className={styles.searchButton} aria-label="Search">
          <Search size={18} aria-hidden="true" />
        </button>
      </form>

      {/* Main Navigation Links */}
      <nav className={styles.navSection} aria-label="Quick links">
        <NavLink
          to={ROUTES.HOME}
          className={({ isActive }) =>
            cn(styles.navItem, isActive && location.pathname === ROUTES.HOME && styles.activeItem)
          }
          onClick={handleLinkClick}
        >
          <span className={styles.navLabel}>Home</span>
        </NavLink>

        <NavLink
          to={ROUTES.ABOUT}
          className={({ isActive }) => cn(styles.navItem, isActive && styles.activeItem)}
          onClick={handleLinkClick}
        >
          <span className={styles.navLabel}>About Us</span>
          <ChevronRight size={16} className={styles.navChevron} aria-hidden="true" />
        </NavLink>

        <NavLink
          to={ROUTES.CONTACT}
          className={({ isActive }) => cn(styles.navItem, isActive && styles.activeItem)}
          onClick={handleLinkClick}
        >
          <span className={styles.navLabel}>Contact Us</span>
        </NavLink>
      </nav>

      {/* Products & Services Section */}
      <div className={styles.productsSection}>
        <div className={styles.sectionHeadingWrapper}>
          <h2 className={styles.sectionHeading}>Products &amp; Services</h2>
        </div>

        <ul className={styles.categoryList} role="list">
          {categoriesLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className={styles.skeletonItem} aria-hidden="true">
                <span className={styles.skeletonBar} />
              </li>
            ))
          ) : categoryTree.length === 0 ? (
            <li className={styles.emptyCategories}>No categories found</li>
          ) : (
            orderedTree.map((category) => {
              const count = countForNode(category)
              const isOpen = Boolean(openCategories[category.id])
              const isSelected =
                currentCategoryId === category.id || currentCategorySlug === category.slug
              const hasChildren = category.children && category.children.length > 0
              const formattedName = formatCategoryName(category.name)

              return (
                <li key={category.id} className={styles.categoryItem}>
                  <div
                    className={cn(
                      styles.categoryRow,
                      isSelected && styles.categoryRowSelected,
                    )}
                  >
                    <NavLink
                      to={`${ROUTES.PRODUCTS}?categoryId=${encodeURIComponent(category.id)}`}
                      className={styles.categoryLink}
                      onClick={handleLinkClick}
                    >
                      <span className={styles.categoryTitle}>{formattedName}</span>
                      <span className={styles.categoryCount}>({count})</span>
                    </NavLink>

                    <button
                      type="button"
                      className={cn(
                        styles.chevronButton,
                        isOpen && styles.chevronButtonActive,
                      )}
                      onClick={() => toggleCategory(category.id)}
                      aria-expanded={isOpen}
                      aria-label={`Toggle ${formattedName} dropdown`}
                    >
                      <ChevronDown
                        size={16}
                        className={cn(styles.chevronIcon, isOpen && styles.chevronIconOpen)}
                        aria-hidden="true"
                      />
                    </button>
                  </div>

                  {isOpen && (
                    <div className={styles.dropdownPanel}>
                      {hasChildren && (
                        <ul className={styles.subCategoryList} role="list">
                          {category.children.map((sub) => {
                            const subCount = countForNode(sub)
                            const isSubSelected =
                              currentCategoryId === sub.id || currentCategorySlug === sub.slug

                            return (
                              <li key={sub.id} className={styles.subCategoryItem}>
                                <NavLink
                                  to={`${ROUTES.PRODUCTS}?categoryId=${encodeURIComponent(sub.id)}`}
                                  className={cn(
                                    styles.subCategoryLink,
                                    isSubSelected && styles.subCategoryLinkSelected,
                                  )}
                                  onClick={handleLinkClick}
                                >
                                  <span>{formatCategoryName(sub.name)}</span>
                                  <span className={styles.categoryCount}>({subCount})</span>
                                </NavLink>
                              </li>
                            )
                          })}
                        </ul>
                      )}

                      <CategoryProductPreview
                        categoryId={category.id}
                        enabled={isOpen}
                        onLinkClick={handleLinkClick}
                      />

                      <div className={styles.viewAllContainer}>
                        <NavLink
                          to={`${ROUTES.PRODUCTS}?categoryId=${encodeURIComponent(category.id)}`}
                          className={styles.viewAllLink}
                          onClick={handleLinkClick}
                        >
                          View all {formattedName} ({count}) &rarr;
                        </NavLink>
                      </div>
                    </div>
                  )}
                </li>
              )
            })
          )}
        </ul>
      </div>
    </aside>
  )
}
