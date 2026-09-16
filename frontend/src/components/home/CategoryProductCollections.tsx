import { ProductCollection } from './ProductRail'
import { categoryLeaves } from '@/features/catalog/categoryNavOrder'
import { useCategoryTree } from '@/hooks/useCategoryTree'
import { ROUTES } from '@/constants/routes'

const MAX_CATEGORY_RAILS = 2

/**
 * One product collection per live leaf category. Titles come from the
 * category name (e.g. Corporate Gifting if that category exists).
 * Category tree is the same TanStack Query as Header / Footer / StoryBar.
 */
export function CategoryProductCollections() {
  const { data: tree = [] } = useCategoryTree()

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
