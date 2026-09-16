import { Link } from 'react-router-dom'
import type { Banner } from '@/services/api/settings'
import { optimizedCloudinaryUrl } from '@/features/media/mediaAsset'
import styles from './BannerGrid.module.css'

interface BannerGridProps {
  banners: Banner[]
}

export function BannerGrid({ banners }: BannerGridProps) {
  if (!banners.length) return null

  return (
    <section className={styles.section} aria-label="Promotional banners">
      <div className={styles.grid}>
        {banners.map((banner, index) => (
          <article key={index} className={styles.card}>
            {banner.link ? (
              <Link to={banner.link} className={styles.link}>
                <BannerContent banner={banner} />
              </Link>
            ) : (
              <div className={styles.contentWrapper}>
                <BannerContent banner={banner} />
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}

function BannerContent({ banner }: { banner: Banner }) {
  return (
    <div className={styles.content}>
      {banner.imageUrl && (
        <img
          src={optimizedCloudinaryUrl(banner.imageUrl, 900)}
          alt={banner.title || banner.text || ''}
          className={styles.image}
          loading="lazy"
          decoding="async"
        />
      )}
      <div className={styles.overlay}>
        {banner.title && <h2 className={styles.title}>{banner.title}</h2>}
        {banner.text && <p className={styles.text}>{banner.text}</p>}
      </div>
    </div>
  )
}
