import { useMemo } from 'react'
import { useProducts } from '@/hooks/useProducts'
import { ProductCard } from './ProductCard'
import styles from './RelatedProducts.module.css'

const RELATED_LIMIT = 4

/** "You may also like" row on the product page: other active products from
 * the same category. Renders nothing while loading, on error, or when the
 * category has no other products — it is an extra, never a blocker. */
export function RelatedProducts({
  categoryId,
  currentProductId,
}: {
  categoryId: string
  currentProductId: string
}) {
  const { data } = useProducts({ categoryId, limit: RELATED_LIMIT + 1, sort: 'newest' })

  const related = useMemo(
    () => (data?.items ?? []).filter((p) => p.id !== currentProductId).slice(0, RELATED_LIMIT),
    [data, currentProductId],
  )

  if (related.length === 0) return null

  return (
    <section className={styles.section} aria-labelledby="related-products-heading">
      <h2 id="related-products-heading" className={styles.heading}>
        You may also like
      </h2>
      <div className={styles.grid}>
        {related.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  )
}
