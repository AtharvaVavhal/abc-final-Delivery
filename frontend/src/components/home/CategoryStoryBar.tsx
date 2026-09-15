import { useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchCategoryTree, fetchProducts } from '@/services/api/catalog'
import { categoryLeaves, categoryStillImage } from '@/features/catalog/categoryNavOrder'
import { stillImageUrl, videoUrl } from '@/features/media/mediaAsset'
import { DeferredVideo } from '@/components/media/DeferredVideo'
import { HorizontalScroller } from '@/components/ui/HorizontalScroller'
import { CATALOG_STALE_TIME_MS } from '@/constants/query'
import { ROUTES } from '@/constants/routes'
import type { CategoryTreeNode, Product } from '@/types/catalog'
import styles from './CategoryStoryBar.module.css'

export interface StoryCategory {
  id: string
  title: string
  image: string
  href: string
  video?: string
}

export type CategoryCircleItem = StoryCategory

function storiesFromCatalog(
  tree: CategoryTreeNode[],
  products: Product[],
): StoryCategory[] {
  return categoryLeaves(tree).map((category) => {
    const inCategory = products.filter((product) => product.categoryId === category.id)
    const withMedia = inCategory.find((product) => stillImageUrl(product) || videoUrl(product))
    const video = inCategory.map(videoUrl).find(Boolean) ?? ''
    return {
      id: category.id,
      title: category.name,
      image: stillImageUrl(withMedia) || categoryStillImage(category.slug),
      href: `${ROUTES.PRODUCTS}?categoryId=${encodeURIComponent(category.id)}`,
      video: video || undefined,
    }
  })
}

function CircleMedia({ item }: { item: StoryCategory }) {
  const initial = item.title.trim().charAt(0).toUpperCase() || '?'
  return (
    <div className={styles.circleWrapper}>
      <div className={styles.circleInner}>
        {item.video ? (
          <DeferredVideo
            src={item.video}
            poster={item.image || undefined}
            label={`${item.title} category video`}
            className={styles.circleImage}
          />
        ) : item.image ? (
          <img
            src={item.image}
            alt=""
            className={styles.circleImage}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span className={styles.imageFallback} aria-hidden="true">
            {initial}
          </span>
        )}
      </div>
    </div>
  )
}

export function CategoryCircleCarousel({ stories }: { stories?: StoryCategory[] }) {
  const location = useLocation()
  const live = stories === undefined
  const treeQuery = useQuery({
    queryKey: ['categories', 'tree'],
    queryFn: fetchCategoryTree,
    staleTime: CATALOG_STALE_TIME_MS,
    enabled: live,
  })
  const productsQuery = useQuery({
    queryKey: ['products', 'list', { limit: 100, sort: 'newest' as const }],
    queryFn: () => fetchProducts({ limit: 100, sort: 'newest' }),
    staleTime: CATALOG_STALE_TIME_MS,
    enabled: live,
  })

  const resolvedStories = useMemo(() => {
    if (stories) return stories
    return storiesFromCatalog(treeQuery.data ?? [], productsQuery.data?.items ?? [])
  }, [stories, treeQuery.data, productsQuery.data?.items])

  const activeParam = new URLSearchParams(location.search).get('categoryId')

  if (live && (treeQuery.isPending || resolvedStories.length === 0)) {
    return null
  }

  return (
    <nav className={styles.container} aria-label="Shop by category">
      <HorizontalScroller
        ariaLabel="Categories"
        className={styles.scroller}
        trackClassName={styles.scrollTrack}
      >
        {resolvedStories.map((item) => {
          const isActive = activeParam === item.id
          return (
            <Link
              key={item.id}
              to={item.href}
              className={`${styles.storyItem} ${isActive ? styles.storyItemActive : ''}`}
              aria-current={isActive ? 'page' : undefined}
            >
              <CircleMedia item={item} />
              <span className={styles.title}>{item.title}</span>
            </Link>
          )
        })}
      </HorizontalScroller>
    </nav>
  )
}

/** @deprecated Prefer CategoryCircleCarousel — kept for existing tests/imports. */
export const CategoryStoryBar = CategoryCircleCarousel
