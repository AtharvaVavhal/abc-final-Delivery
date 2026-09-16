import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchCategoryTree, fetchProducts } from '@/services/api/catalog'
import { categoryLeaves, categoryStillImage } from '@/features/catalog/categoryNavOrder'
import { stillImageUrl, videoUrl, optimizedCloudinaryUrl } from '@/features/media/mediaAsset'
import { DeferredVideo } from '@/components/media/DeferredVideo'
import { CATALOG_STALE_TIME_MS } from '@/constants/query'
import { ROUTES } from '@/constants/routes'
import type { ShowcaseCategory } from '@/services/api/settings'
import { HorizontalScroller } from '@/components/ui/HorizontalScroller'
import { SectionHeading } from './SectionHeading'
import styles from './CategoryDiscovery.module.css'

interface DiscoveryItem {
  id: string
  title: string
  href: string
  image?: string
  video?: string
}

export function CategoryDiscovery({
  curated,
}: {
  curated?: ShowcaseCategory[]
}) {
  const treeQuery = useQuery({
    queryKey: ['categories', 'tree'],
    queryFn: fetchCategoryTree,
    staleTime: CATALOG_STALE_TIME_MS,
    enabled: !curated?.length,
  })
  const productsQuery = useQuery({
    queryKey: ['products', 'list', { limit: 100, sort: 'newest' as const }],
    queryFn: () => fetchProducts({ limit: 100, sort: 'newest' }),
    staleTime: CATALOG_STALE_TIME_MS,
    enabled: !curated?.length,
  })

  const items = useMemo<DiscoveryItem[]>(() => {
    if (curated?.length) {
      return curated.map((category) => ({
        id: category.categoryId,
        title: category.title,
        href: `${ROUTES.PRODUCTS}?categoryId=${encodeURIComponent(category.categoryId)}`,
        image: category.imageUrl || undefined,
      }))
    }
    const products = productsQuery.data?.items ?? []
    return categoryLeaves(treeQuery.data ?? []).map((category) => {
      const match = products.find((product) => product.categoryId === category.id)
      return {
        id: category.id,
        title: category.name,
        href: `${ROUTES.PRODUCTS}?categoryId=${encodeURIComponent(category.id)}`,
        image: stillImageUrl(match) || categoryStillImage(category.slug) || undefined,
        video: videoUrl(match) || undefined,
      }
    })
  }, [curated, treeQuery.data, productsQuery.data?.items])

  if (!curated?.length && (treeQuery.isPending || items.length === 0)) return null

  return (
    <section className={styles.section} aria-labelledby="category-discovery-heading">
      <SectionHeading
        id="category-discovery-heading"
        title="Shop by category"
        viewAllHref={ROUTES.PRODUCTS}
        viewAllLabel="All products"
      />
      <HorizontalScroller ariaLabel="Category collections" className={styles.scroller}>
        {items.map((item) => (
          <Link key={item.id} to={item.href} className={styles.card}>
            <div className={styles.media}>
              {item.video ? (
                <DeferredVideo
                  src={item.video}
                  poster={item.image ? optimizedCloudinaryUrl(item.image, 480) : undefined}
                  label={item.title}
                />
              ) : item.image ? (
                <img src={optimizedCloudinaryUrl(item.image, 480)} alt="" loading="lazy" decoding="async" />
              ) : (
                <span className={styles.fallback} aria-hidden="true">
                  {item.title.trim().charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <span className={styles.name}>{item.title}</span>
          </Link>
        ))}
      </HorizontalScroller>
    </section>
  )
}
