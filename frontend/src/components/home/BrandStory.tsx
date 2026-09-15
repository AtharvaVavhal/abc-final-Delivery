import { Link } from 'react-router-dom'
import { ROUTES } from '@/constants/routes'
import { useStoreName } from '@/hooks/useStoreName'
import styles from './BrandStory.module.css'

const DEFAULT_STORY =
  'AB Creations is a custom-printing store that lets customers design and order printed products entirely online. From product discovery through file upload, checkout, production and delivery — every step is handled in a single, transparent workflow. Professional-grade custom printing for individuals and small businesses, without a traditional print-shop back-and-forth.'

export function BrandStory({
  story,
  imageUrl,
}: {
  story?: string
  imageUrl?: string
}) {
  const storeName = useStoreName()
  const copy = story?.trim() || DEFAULT_STORY

  return (
    <section className={styles.section} aria-labelledby="brand-story-heading">
      <div className={styles.grid}>
        <div className={styles.media}>
          {imageUrl ? (
            <img src={imageUrl} alt="" className={styles.image} loading="lazy" />
          ) : (
            <div className={styles.fallback} aria-hidden="true">
              {storeName}
            </div>
          )}
        </div>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>About {storeName}</p>
          <h2 id="brand-story-heading" className={styles.title}>
            Our Story
          </h2>
          <p className={styles.body}>{copy}</p>
          <Link to={ROUTES.ABOUT} className={styles.link}>
            Read more
          </Link>
        </div>
      </div>
    </section>
  )
}
