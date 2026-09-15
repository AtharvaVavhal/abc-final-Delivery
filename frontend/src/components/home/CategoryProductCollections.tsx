import { useQuery } from '@tanstack/react-query'
import { fetchCategoryTree } from '@/services/api/catalog'
import { ProductCollection } from './ProductRail'
import { categoryLeaves } from '@/features/catalog/categoryNavOrder'
import { CATALOG_STALE_TIME_MS } from '@/constants/query'
import { ROUTES } from '@/constants/routes'

const MAX_CATEGORY_RAILS = 2

/**
 * One product collection per live leaf category. Titles come from the
 * category name (e.g. Corporate Gifting if that category exists).
 */
export function CategoryProductCollections() {
  const { data: tree = [] } = useQuery({
    queryKey: ['categories', 'tree'],
    queryFn: fetchCategoryTree,
    staleTime: CATALOG_STALE_TIME_MS,
  })

  const leaves = categoryLeaves(tree).slice(0, MAX_CATEGORY_RAILS)

  return (
    <>
      {leaves.map((category) => (
        <ProductCollection
          key={category.id}
          id={`home-collection-${category.id}`}
          title={category.name}
          params={{ categoryId: category.id, sort: 'newest' }}
          viewAllHref={`${ROUTES.PRODUCTS}?categoryId=${encodeURIComponent(category.id)}`}
        />
      ))}
    </>
  )
}
