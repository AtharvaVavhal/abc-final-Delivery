import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react'
import { cn } from '@/utils/cn'
import { useProducts } from '@/hooks/useProducts'
import { useCategoryTree } from '@/hooks/useCategoryTree'
import { getApiErrorMessage } from '@/utils/apiError'
import { ROUTES, categoryListingPath } from '@/constants/routes'
import { Alert } from '@/components/ui/Alert'
import { Breadcrumbs, type Crumb } from '@/components/ui/Breadcrumbs'
import { Pagination } from '@/components/ui/Pagination'
import { FilterSidebar } from '@/components/layout/FilterSidebar'
import { MobileFilterDrawer } from '@/components/layout/MobileFilterDrawer'
import { ActiveFilterChips } from '@/features/catalog/ActiveFilterChips'
import { findCategoryBySlug, findCategoryPath } from '@/features/catalog/categoryTree'
import { Seo } from '@/seo/Seo'
import { breadcrumbJsonLd, collectionJsonLd, type JsonLdObject } from '@/seo/jsonLd'
import { catalogDescription, categoryDescription } from '@/seo/pageCopy'
import { EmptyCatalog } from '@/features/catalog/EmptyCatalog'
import { ProductCard } from '@/features/catalog/ProductCard'
import { ProductGridSkeleton } from '@/features/catalog/ProductGridSkeleton'
import { CategoryStoryBar } from '@/components/home/CategoryStoryBar'
import gridStyles from '@/features/catalog/ProductGrid.module.css'
import type { ListProductsParams } from '@/types/catalog'
import styles from './ProductListPage.module.css'

const DEFAULT_LIMIT = 20

function getOptionalNumber(value: string | null): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function getSort(value: string | null): ListProductsParams['sort'] {
  if (
    value === 'newest' ||
    value === 'price_asc' ||
    value === 'price_desc' ||
    value === 'rating_desc'
  ) {
    return value
  }
  return undefined
}

export function ProductListPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState(false)
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false)
  const categoryParam = searchParams.get('category') ?? undefined
  const categoryId = searchParams.get('categoryId') ?? undefined
  const search = searchParams.get('search') ?? undefined
  const page = Number(searchParams.get('page') ?? '1')
  const minPrice = getOptionalNumber(searchParams.get('minPrice'))
  const maxPrice = getOptionalNumber(searchParams.get('maxPrice'))
  const minRating = getOptionalNumber(searchParams.get('minRating'))
  const sort = getSort(searchParams.get('sort'))

  const hasProductFilters = Boolean(
    categoryId ||
    categoryParam ||
    minPrice !== undefined ||
    maxPrice !== undefined ||
    minRating !== undefined ||
    sort,
  )
  const hasResultFilters = Boolean(search || hasProductFilters)

  const activeFilterCount = useMemo(() => {
    let count = 0
    if (categoryId || categoryParam) count++
    if (minPrice !== undefined || maxPrice !== undefined) count++
    if (minRating !== undefined) count++
    if (sort) count++
    return count
  }, [categoryId, categoryParam, minPrice, maxPrice, minRating, sort])

  const { data: categoryTree = [] } = useCategoryTree()
  const categoryBySlug = useMemo(
    () => findCategoryBySlug(categoryTree, categoryParam),
    [categoryTree, categoryParam],
  )
  const resolvedCategoryId = categoryId ?? categoryBySlug?.id
  const categoryPath = useMemo(
    () => findCategoryPath(categoryTree, resolvedCategoryId),
    [categoryTree, resolvedCategoryId],
  )
  const activeCategory = categoryPath.at(-1) ?? categoryBySlug

  const pageTitle = activeCategory
    ? activeCategory.name
    : search
      ? 'Search results'
      : 'All products'

  const breadcrumbs: Crumb[] = [
    { label: 'Home', to: ROUTES.HOME },
    activeCategory || search || categoryParam
      ? { label: 'All products', to: ROUTES.PRODUCTS }
      : { label: 'All products' },
    ...categoryPath.map((node, index) => ({
      label: node.name,
      to:
        index === categoryPath.length - 1
          ? undefined
          : categoryListingPath(node.slug),
    })),
    ...(search && !activeCategory
      ? [{ label: `“${search}”` }]
      : categoryBySlug && categoryPath.length === 0
        ? [{ label: categoryBySlug.name }]
        : []),
  ]

  // Bare catalog and a single resolved category are indexable. Search,
  // price/rating filters, explicit sort, unknown slugs, and page > 1 stay
  // noindex so crawl budget is not spent on the filter combinatorics.
  const unknownCategorySlug = Boolean(categoryParam && !categoryBySlug)
  const isFilteredVariant = Boolean(
    search ||
    unknownCategorySlug ||
    minPrice !== undefined ||
    maxPrice !== undefined ||
    minRating !== undefined ||
    sort ||
    page > 1,
  )
  const canonicalPath = activeCategory
    ? categoryListingPath(activeCategory.slug)
    : ROUTES.PRODUCTS
  const seoDescription = activeCategory
    ? categoryDescription(activeCategory.name, activeCategory.slug)
    : catalogDescription()

  // `?category=<slug>` links pass a category *slug*, not the *id* GET
  // /products filters by — resolve against the live tree. Unknown slugs
  // fall through to a free-text search on the slug itself.
  const effectiveCategoryId = resolvedCategoryId

  const productsQuery = useProducts({
    categoryId: effectiveCategoryId,
    search: search || (categoryParam && !categoryBySlug ? categoryParam : undefined),
    page,
    limit: DEFAULT_LIMIT,
    minPrice,
    maxPrice,
    minRating,
    sort,
  })

  function goToPage(nextPage: number) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('page', String(nextPage))
      return next
    })
  }

  function handleClearAllFilters() {
    setIsFilterDrawerOpen(false)
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('page')
      next.delete('category')
      next.delete('categoryId')
      next.delete('minPrice')
      next.delete('maxPrice')
      next.delete('minRating')
      next.delete('sort')
      return next
    })
  }

  return (
    <>
      <CategoryStoryBar />

      <section className={styles.wrap}>
        <Seo
          title={pageTitle}
          description={seoDescription}
          canonicalPath={canonicalPath}
          noindex={isFilteredVariant}
          jsonLd={
            isFilteredVariant
              ? undefined
              : [
                  breadcrumbJsonLd(breadcrumbs),
                  productsQuery.data
                    ? collectionJsonLd({
                        name: pageTitle,
                        path: canonicalPath,
                        products: productsQuery.data.items,
                        total: productsQuery.data.meta.total,
                        page: productsQuery.data.meta.page,
                        limit: productsQuery.data.meta.limit,
                      })
                    : null,
                ].filter((block): block is JsonLdObject => block != null)
          }
        />
        <Breadcrumbs items={breadcrumbs} />

        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>{pageTitle}</h1>
            {search && !activeCategory && (
              <p className={styles.searchResultLabel}>Results for "{search}"</p>
            )}
          </div>
          {productsQuery.data && (
            <p className={styles.resultCount} aria-live="polite">
              {productsQuery.data.meta.total} {productsQuery.data.meta.total === 1 ? 'product' : 'products'}
            </p>
          )}
        </div>

        <ActiveFilterChips />

        {/* Expandable Filter Toolbar right before products */}
        <div className={styles.filterSection}>
          <div className={styles.filterToolbar}>
            <button
              type="button"
              className={cn(
                styles.filterToggleBtn,
                isFilterPanelOpen && styles.filterToggleBtnActive,
              )}
              onClick={() => setIsFilterPanelOpen((prev) => !prev)}
              aria-expanded={isFilterPanelOpen}
              aria-controls="vertical-filter-panel"
            >
              <SlidersHorizontal size={17} aria-hidden="true" />
              <span>{isFilterPanelOpen ? 'Hide Filters' : 'Filter Products'}</span>
              {activeFilterCount > 0 && (
                <span className={styles.filterBadge}>{activeFilterCount}</span>
              )}
              <ChevronDown
                size={17}
                className={cn(styles.chevronIcon, isFilterPanelOpen && styles.chevronRotated)}
                aria-hidden="true"
              />
            </button>

            <div className={styles.filterToolbarMeta}>
              {hasProductFilters && (
                <button
                  type="button"
                  onClick={handleClearAllFilters}
                  className={styles.clearAllInline}
                >
                  <X size={14} aria-hidden="true" />
                  Clear filters
                </button>
              )}
              {productsQuery.data && (
                <span className={styles.resultCountText} aria-live="polite">
                  {productsQuery.data.meta.total} {productsQuery.data.meta.total === 1 ? 'product' : 'products'}
                </span>
              )}
            </div>
          </div>

          <div
            id="vertical-filter-panel"
            className={cn(
              styles.verticalFilterContainer,
              isFilterPanelOpen && styles.verticalFilterContainerOpen,
            )}
          >
            <div className={styles.verticalFilterInner}>
              <FilterSidebar
                variant="panel"
                activeCategoryId={effectiveCategoryId}
                hasActiveFilters={hasProductFilters}
                onClearAll={handleClearAllFilters}
                onClose={() => setIsFilterPanelOpen(false)}
              />
            </div>
          </div>
        </div>

        <div className={styles.catalogLayout}>

          <div className={styles.results}>
            {productsQuery.isPending && <ProductGridSkeleton label="Loading products" />}

            {productsQuery.isError && (
              <Alert variant="error">{getApiErrorMessage(productsQuery.error)}</Alert>
            )}

            {productsQuery.data && productsQuery.isFetching && (
              <p className={styles.updating} aria-live="polite">
                Updating results...
              </p>
            )}

            {productsQuery.data && productsQuery.data.items.length === 0 && (
              <EmptyCatalog hasFilter={hasResultFilters} />
            )}

            {productsQuery.data && productsQuery.data.items.length > 0 && (
              <>
                <div className={gridStyles.grid}>
                  {productsQuery.data.items.map((product) => (
                    <ProductCard key={product.id} product={product} headingLevel={2} />
                  ))}
                </div>

                <Pagination
                  page={productsQuery.data.meta.page}
                  totalPages={productsQuery.data.meta.totalPages}
                  onPageChange={goToPage}
                  label="Products pagination"
                />
              </>
            )}
          </div>
        </div>

        <MobileFilterDrawer
          isOpen={isFilterDrawerOpen}
          onClose={() => setIsFilterDrawerOpen(false)}
          activeCategoryId={effectiveCategoryId}
          hasActiveFilters={hasProductFilters}
          onClearAll={handleClearAllFilters}
        />
      </section>
    </>
  )
}
