import { useMemo, useState } from 'react'
import type { ProductImage as ProductImageData } from '@/types/catalog'
import { isVideoAsset, optimizedCloudinaryUrl } from '@/features/media/mediaAsset'
import { DeferredVideo } from '@/components/media/DeferredVideo'
import { ProductImagePlaceholder } from './ProductImagePlaceholder'
import styles from './ProductGallery.module.css'

/**
 * Product-detail media viewer. Still images and Cloudinary videos from the
 * product's own `images` list — never a second media source.
 */
export function ProductGallery({
  images,
  label,
}: {
  images: ProductImageData[]
  label: string
}) {
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set())
  const [activeIndex, setActiveIndex] = useState(0)

  const usable = useMemo(() => {
    const ordered = [...images].sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1
      return a.sortOrder - b.sortOrder
    })
    return ordered.filter((img) => img.url && !failedIds.has(img.id))
  }, [images, failedIds])

  if (usable.length === 0) {
    return (
      <div className={styles.main}>
        <ProductImagePlaceholder label={label} />
      </div>
    )
  }

  const safeIndex = Math.min(activeIndex, usable.length - 1)
  const active = usable[safeIndex]

  function markFailed(id: string) {
    setFailedIds((prev) => new Set(prev).add(id))
  }

  const activeIsVideo = isVideoAsset(active)
  const stillPoster = usable.find((img) => !isVideoAsset(img))?.url

  return (
    <div className={styles.gallery}>
      <div className={styles.main}>
        {activeIsVideo ? (
          <DeferredVideo
            key={active.id}
            src={active.url}
            poster={stillPoster ? optimizedCloudinaryUrl(stillPoster, 1200) : undefined}
            label={label}
            className={styles.mainImage}
          />
        ) : (
          <img
            key={active.id}
            src={optimizedCloudinaryUrl(active.url, 1200)}
            alt={label}
            className={styles.mainImage}
            width={1200}
            height={1200}
            referrerPolicy="no-referrer"
            onError={() => markFailed(active.id)}
          />
        )}
      </div>

      {usable.length > 1 && (
        <ul className={styles.thumbs} aria-label="Product images">
          {usable.map((img, index) => (
            <li key={img.id}>
              <button
                type="button"
                className={styles.thumbButton}
                aria-current={index === safeIndex ? 'true' : undefined}
                aria-label={`Show image ${index + 1} of ${usable.length}`}
                onClick={() => setActiveIndex(index)}
              >
                {isVideoAsset(img) ? (
                  <span className={styles.thumbImage}>Video</span>
                ) : (
                  <img
                    src={optimizedCloudinaryUrl(img.url, 200)}
                    alt=""
                    className={styles.thumbImage}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onError={() => markFailed(img.id)}
                  />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
