import { useMemo, useState } from 'react'
import type { ProductImage as ProductImageData } from '@/types/catalog'
import { isVideoAsset, optimizedCloudinaryUrl } from '@/features/media/mediaAsset'
import { ProductImagePlaceholder } from './ProductImagePlaceholder'
import styles from './ProductImage.module.css'

interface ProductImageProps {
  images: ProductImageData[]
  label: string
  /** Display width hint for Cloudinary `c_limit,w_*`. */
  displayWidth?: number
}

/**
 * Renders a product's primary still image. Video assets are skipped so a
 * Cloudinary MP4 is never stuffed into an <img>. If the first still 404s,
 * later gallery stills are tried before the custom-print placeholder.
 */
export function ProductImage({ images, label, displayWidth = 480 }: ProductImageProps) {
  const stills = useMemo(() => {
    const usable = images.filter((img) => img.url && !isVideoAsset(img))
    return [...usable].sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1
      return a.sortOrder - b.sortOrder
    })
  }, [images])
  const [skip, setSkip] = useState(0)
  const image = stills[skip]

  if (!image) {
    return <ProductImagePlaceholder label={label} />
  }

  return (
    <img
      key={image.id}
      src={optimizedCloudinaryUrl(image.url, displayWidth)}
      alt={label}
      className={styles.image}
      width={displayWidth}
      height={displayWidth}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={(event) => {
        const src = event.currentTarget.currentSrc || event.currentTarget.src
        if (!src) return
        setSkip((current) => current + 1)
      }}
    />
  )
}
