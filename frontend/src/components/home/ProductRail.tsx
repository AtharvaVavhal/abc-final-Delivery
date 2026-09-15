import { useProducts } from '@/hooks/useProducts'
import type { ListProductsParams } from '@/types/catalog'
import { ProductCard } from '@/features/catalog/ProductCard'
import { ProductCardSkeleton } from '@/features/catalog/ProductCardSkeleton'
import { HorizontalScroller } from '@/components/ui/HorizontalScroller'
import { SectionHeading } from './SectionHeading'
import { cn } from '@/utils/cn'
import styles from './ProductRail.module.css'

export interface ProductCollectionProps {
  id: string
  title: string
  subtitle?: string
  params: ListProductsParams
  viewAllHref: string
  viewAllLabel?: string
  layout?: 'rail' | 'grid'
}

const SKELETON_COUNT = 5

/**
 * Reusable product collection. Backed entirely by GET /products.
 * Empty or error responses hide the section.
 */
export function ProductCollection({
  id,
  title,
  subtitle,
  params,
  viewAllHref,
  viewAllLabel,
  layout = 'rail',
}: ProductCollectionProps) {
  const { data, isPending, isError } = useProducts({ limit: layout === 'grid' ? 8 : 12, ...params })

  if (isError) return null

  const items = data?.items ?? []
  if (!isPending && items.length === 0) return null

  const cards = isPending
    ? Array.from({ length: SKELETON_COUNT }, (_, i) => (
        <div key={i} className={styles.item} aria-hidden="true">
          <ProductCardSkeleton />
        </div>
      ))
    : items.map((product) => (
        <div key={product.id} className={styles.item}>
          <ProductCard product={product} />
        </div>
      ))

  return (
    <section className={cn(styles.section, layout === 'grid' && styles.featured)} aria-labelledby={id}>
      <SectionHeading
        id={id}
        title={title}
        subtitle={subtitle}
        viewAllHref={viewAllHref}
        viewAllLabel={viewAllLabel}
      />

      {layout === 'grid' ? (
        <div className={styles.grid}>{cards}</div>
      ) : (
        <HorizontalScroller ariaLabel={title} className={styles.scroller} trackClassName={styles.railTrack}>
          {cards}
        </HorizontalScroller>
      )}
    </section>
  )
}

/** Alias used by the existing homepage rails. */
export function ProductRail(props: ProductCollectionProps) {
  return <ProductCollection {...props} />
}

export function ProductCarousel(props: ProductCollectionProps) {
  return <ProductCollection {...props} layout="rail" />
}
