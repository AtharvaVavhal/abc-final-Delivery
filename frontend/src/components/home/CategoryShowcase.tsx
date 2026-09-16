import { Link } from 'react-router-dom'
import type { ShowcaseCategory } from '@/services/api/settings'
import { optimizedCloudinaryUrl } from '@/features/media/mediaAsset'
import styles from './CategoryShowcase.module.css'

interface CategoryShowcaseProps {
  categories: ShowcaseCategory[]
}

export function CategoryShowcase({ categories }: CategoryShowcaseProps) {
  if (!categories.length) return null

  return (
    <section className={styles.section} aria-labelledby="showcase-heading">
      <div className={styles.header}>
        <h2 id="showcase-heading" className={styles.heading}>
          Shop by Category
        </h2>
      </div>
      <div className={styles.grid}>
        {categories.map((cat, index) => (
          <article key={index} className={styles.card}>
            <Link to={`/products?categoryId=${cat.categoryId}`} className={styles.link} aria-label={`Shop ${cat.title}`}>
              <div className={styles.imageWrapper}>
                {cat.imageUrl && (
                  <img
                    src={optimizedCloudinaryUrl(cat.imageUrl, 640)}
                    alt=""
                    className={styles.image}
                    width={640}
                    height={640}
                    loading="lazy"
                  />
                )}
              </div>
              <div className={styles.overlay}>
                <h3 className={styles.title}>{cat.title}</h3>
              </div>
            </Link>
          </article>
        ))}
      </div>
    </section>
  )
}
