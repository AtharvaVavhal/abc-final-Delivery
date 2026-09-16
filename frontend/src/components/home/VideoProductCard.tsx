import { Link } from 'react-router-dom'
import type { Product } from '@/types/catalog'
import { formatPrice } from '@/utils/formatPrice'
import { productDetailPath } from '@/constants/routes'
import { optimizedCloudinaryUrl, stillImageUrl, videoUrl } from '@/features/media/mediaAsset'
import { DeferredVideo } from '@/components/media/DeferredVideo'
import { ProductImage } from '@/features/catalog/ProductImage'
import styles from './VideoProductCard.module.css'

export function VideoProductCard({ product }: { product: Product }) {
  const clip = videoUrl(product)
  const poster = stillImageUrl(product)
  const customizable = product.customizationFields.length > 0
  const href = productDetailPath(product.slug)
  const cta = customizable ? 'Customize Now' : 'View Product'

  return (
    <article className={styles.card}>
      <Link to={href} className={styles.media} aria-label={product.name}>
        {clip ? (
          <DeferredVideo
            src={clip}
            poster={poster ? optimizedCloudinaryUrl(poster, 640) : undefined}
            label={product.name}
          />
        ) : poster ? (
          <img
            src={optimizedCloudinaryUrl(poster, 640)}
            alt=""
            className={styles.still}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <ProductImage images={product.images} label={product.name} />
        )}
      </Link>
      <div className={styles.meta}>
        <div className={styles.thumb} aria-hidden="true">
          <ProductImage images={product.images} label={product.name} />
        </div>
        <div className={styles.copy}>
          <Link to={href} className={styles.name}>
            {product.name}
          </Link>
          <p className={styles.price}>
            {product.variants.length > 0 ? 'From ' : ''}
            {formatPrice(product.basePrice)}
          </p>
        </div>
        <Link to={href} className={styles.cta}>
          {cta}
        </Link>
      </div>
    </article>
  )
}
