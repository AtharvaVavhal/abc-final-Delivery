import { HorizontalScroller } from '@/components/ui/HorizontalScroller'
import { optimizedCloudinaryUrl } from '@/features/media/mediaAsset'
import styles from './FeaturedMediaCarousel.module.css'

export function FeaturedMediaCarousel({ urls }: { urls: string[] }) {
  const images = urls.map((url) => url.trim()).filter(Boolean)
  if (images.length === 0) return null

  return (
    <section className={styles.section} aria-labelledby="got-featured-heading">
      <p className={styles.eyebrow}>As seen</p>
      <h2 id="got-featured-heading" className={styles.title}>
        Got Featured
      </h2>
      <div className={styles.diamond} aria-hidden="true" />
      <HorizontalScroller ariaLabel="Featured media" className={styles.scroller}>
        {images.map((url) => (
          <figure key={url} className={styles.frame}>
            <img src={optimizedCloudinaryUrl(url, 640)} alt="" loading="lazy" decoding="async" />
          </figure>
        ))}
      </HorizontalScroller>
    </section>
  )
}
