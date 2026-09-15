import { useState } from 'react'
import type { ProductImage as ProductImageData } from '@/types/catalog'
import { isVideoAsset } from '@/features/media/mediaAsset'
import { ProductImagePlaceholder } from './ProductImagePlaceholder'
import styles from './ProductImage.module.css'

interface ProductImageProps {
  images: ProductImageData[]
  label: string
}

/**
 * Renders a product's primary still image. Video assets are skipped so a
 * Cloudinary MP4 is never stuffed into an <img>.
 */
export function ProductImage({ images, label }: ProductImageProps) {
  const [failed, setFailed] = useState(false)
  const stills = images.filter((img) => img.url && !isVideoAsset(img))
  const image = stills.find((img) => img.isPrimary) ?? stills[0]

  if (!image || failed) {
    return <ProductImagePlaceholder label={label} />
  }

  return (
    <img
      src={image.url}
      alt={label}
      className={styles.image}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  )
}
