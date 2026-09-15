import { useState, useMemo, type FormEvent } from 'react'
import { NavLink, useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { Search, ChevronRight, ChevronDown } from 'lucide-react'
import { useCategoryTree } from '@/hooks/useCategoryTree'
import { useProducts } from '@/hooks/useProducts'
import { ROUTES } from '@/constants/routes'
import { cn } from '@/utils/cn'
import { formatCategoryName } from '@/utils/formatCategoryName'
import type { CategoryTreeNode } from '@/types/catalog'
import styles from './LeftNavSidebar.module.css'

interface LeftNavSidebarProps {
  onItemClick?: () => void
  className?: string
}

export function LeftNavSidebar({ onItemClick, className }: LeftNavSidebarProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({})

  const { data: categoryTree = [], isLoading: categoriesLoading } = useCategoryTree()
  const { data: productsData } = useProducts({ limit: 100 })

  const currentCategoryId = searchParams.get('categoryId')
  const currentCategorySlug = searchParams.get('category')

  // Calculate real product counts by categoryId
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    if (productsData?.items) {
      for (const item of productsData.items) {
        if (item.categoryId) {
          counts[item.categoryId] = (counts[item.categoryId] || 0) + 1
        }
      }
    }
    return counts
  }, [productsData])

  // Group products by categoryId for the dropdown lists
  const productsByCategory = useMemo(() => {
    const map: Record<string, { id: string; name: string; slug: string }[]> = {}
    if (productsData?.items) {
      for (const item of productsData.items) {
        if (item.categoryId) {
          if (!map[item.categoryId]) {
            map[item.categoryId] = []
          }
          map[item.categoryId].push({
            id: item.id,
            name: item.name,
            slug: item.slug,
          })
        }
      }
    }
    return map
  }, [productsData])

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

  function getCountForNode(node: CategoryTreeNode): number {
    let direct = categoryCounts[node.id] || 0
    if (node.children?.length) {
      for (const child of node.children) {
        direct += getCountForNode(child)
      }
    }
    return direct
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
            categoryTree.map((category) => {
              const count = getCountForNode(category)
              const isOpen = Boolean(openCategories[category.id])
              const isSelected =
                currentCategoryId === category.id || currentCategorySlug === category.slug
              const hasChildren = category.children && category.children.length > 0
              const categoryProducts = productsByCategory[category.id] || []
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

                  {/* Dropdown content: Subcategories & Products */}
                  {isOpen && (
                    <div className={styles.dropdownPanel}>
                      {/* Subcategories (if any) */}
                      {hasChildren && (
                        <ul className={styles.subCategoryList} role="list">
                          {category.children.map((sub) => {
                            const subCount = getCountForNode(sub)
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

                      {/* Products in this category */}
                      {categoryProducts.length > 0 && (
                        <ul className={styles.productList} role="list">
                          {categoryProducts.map((product) => (
                            <li key={product.id} className={styles.productItem}>
                              <NavLink
                                to={`/products/${encodeURIComponent(product.slug)}`}
                                className={styles.productLink}
                                onClick={handleLinkClick}
                                title={product.name}
                              >
                                <span className={styles.productBullet}>•</span>
                                <span className={styles.productName}>{product.name}</span>
                              </NavLink>
                            </li>
                          ))}
                        </ul>
                      )}

                      {/* "View All" link for the category */}
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
