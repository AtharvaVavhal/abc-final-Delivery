import { Link } from 'react-router-dom'
import { Eye } from 'lucide-react'
import type { Product } from '@/types/catalog'
import { formatPrice } from '@/utils/formatPrice'
import { productDetailPath } from '@/constants/routes'
import { StarRating } from '@/features/reviews/StarRating'
import { ProductImage } from './ProductImage'
import { IconButton } from '@/components/ui/IconButton'
import { cn } from '@/utils/cn'
import styles from './ProductCard.module.css'

export function ProductCard({
  product,
  onQuickView,
  headingLevel = 3,
}: {
  product: Product
  onQuickView?: (slug: string) => void
  /** Heading level for the product name (UX-14). Default 3 — correct under
   * a rail's <h2> SectionHeading. The listing page passes 2, where product
   * names sit directly under the page <h1>. */
  headingLevel?: 2 | 3
}) {
  const NameHeading = headingLevel === 2 ? 'h2' : 'h3'
  const variantPills = product.variants.slice(0, 4).map((v) => v.label);
  const hasMoreVariants = product.variants.length > 4;
  // Real availability signal: a product whose every variant is marked
  // unavailable can't be ordered. Products with no variants have no
  // per-variant stock concept, so this only applies when variants exist.
  const isUnavailable =
    product.variants.length > 0 && product.variants.every((v) => !v.isAvailable);
  const isCustomizable =
    !isUnavailable && product.customizationFields && product.customizationFields.length > 0;

  return (
    <article className={cn(styles.card, isUnavailable && styles.unavailable)}>
      <div className={styles.imageWrapper}>
        <Link to={productDetailPath(product.slug)} className={styles.imageLink} aria-label={product.name}>
          <ProductImage key={product.id} images={product.images} label={product.name} />
        </Link>
        {isUnavailable && (
          <span className={styles.unavailableBadge}>Currently unavailable</span>
        )}
        {isCustomizable && (
          <span className={styles.customBadge}>Customizable</span>
        )}
        {onQuickView && (
          <IconButton
            className={styles.quickViewBtn}
            aria-label={`Quick view for ${product.name}`}
            onClick={() => onQuickView(product.slug)}
            size="md"
            variant="ghost"
          >
            <Eye size={18} aria-hidden="true" />
          </IconButton>
        )}
      </div>

      <div className={styles.body}>
        <Link to={productDetailPath(product.slug)} className={styles.nameLink}>
          <NameHeading className={styles.name}>{product.name}</NameHeading>
        </Link>
        <StarRating avgRating={product.avgRating} reviewCount={product.reviewCount} compact />
        <p className={styles.price}>
          {product.variants.length > 0 ? 'From ' : ''}
          {formatPrice(product.basePrice)}
        </p>

        {(variantPills.length > 0) && (
          <div className={styles.swatches} role="list" aria-label="Available variants">
            {variantPills.map((label, idx) => (
              <span key={idx} className={styles.swatchPill}>{label}</span>
            ))}
            {hasMoreVariants && (
              <span className={cn(styles.swatchPill, styles.more)}>+{product.variants.length - 4}</span>
            )}
          </div>
        )}
      </div>
    </article>
  )
}
