import { useMemo } from 'react'
import { useProducts } from '@/hooks/useProducts'
import { videoUrl } from '@/features/media/mediaAsset'
import { NEWEST_PRODUCTS_QUERY } from '@/constants/query'
import { HorizontalScroller } from '@/components/ui/HorizontalScroller'
import { VideoProductCard } from './VideoProductCard'
import styles from './WatchAndBuySection.module.css'

/**
 * Dark “Watch & Buy” rail. Products come from GET /products; only items
 * that already have a video asset appear. View counts are omitted — the
 * backend has no such field.
 */
export function WatchAndBuySection() {
  const { data, isPending, isError } = useProducts(NEWEST_PRODUCTS_QUERY)

  const items = useMemo(
    () => (data?.items ?? []).filter((product) => Boolean(videoUrl(product))),
    [data?.items],
  )

  if (isPending || isError || items.length === 0) return null

  return (
    <section className={styles.section} aria-labelledby="watch-and-buy-heading">
      <div className={styles.inner}>
        <p className={styles.eyebrow}>Watch &amp; Buy</p>
        <h2 id="watch-and-buy-heading" className={styles.title}>
          Watch &amp; Buy
        </h2>
        <HorizontalScroller ariaLabel="Watch and buy products" trackClassName={styles.track}>
          {items.map((product) => (
            <VideoProductCard key={product.id} product={product} />
          ))}
        </HorizontalScroller>
      </div>
    </section>
  )
}
