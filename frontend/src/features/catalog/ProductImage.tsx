import { useState } from 'react'
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
 * Cloudinary MP4 is never stuffed into an <img>.
 */
export function ProductImage({ images, label, displayWidth = 480 }: ProductImageProps) {
  const [failed, setFailed] = useState(false)
  const stills = images.filter((img) => img.url && !isVideoAsset(img))
  const image = stills.find((img) => img.isPrimary) ?? stills[0]

  if (!image || failed) {
    return <ProductImagePlaceholder label={label} />
  }

  return (
    <img
      src={optimizedCloudinaryUrl(image.url, displayWidth)}
      alt={label}
      className={styles.image}
      width={displayWidth}
      height={displayWidth}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  )
}
