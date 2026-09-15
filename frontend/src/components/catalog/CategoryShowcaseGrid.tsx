import { Link } from 'react-router-dom'
import { Star, Gift, Sparkles } from 'lucide-react'
import { ROUTES } from '@/constants/routes'
import type { CategoryShowcaseCard } from './categoryData'
import styles from './CategoryShowcaseGrid.module.css'

interface CategoryShowcaseGridProps {
  cards: CategoryShowcaseCard[]
  categoryTitle: string
}

export function CategoryShowcaseGrid({ cards, categoryTitle }: CategoryShowcaseGridProps) {
  if (!cards || cards.length === 0) return null

  return (
    <section className={styles.section} aria-label={`Featured ${categoryTitle} Options`}>
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <div className={styles.eyebrow}>
            <Sparkles size={14} aria-hidden="true" />
            <span>Featured {categoryTitle} Selection</span>
          </div>
          <h2 className={styles.title}>Most Popular & Trending Styles</h2>
          <p className={styles.subtitle}>
            Choose your preferred variant, finish, and dimensions — personalized to your exact specifications.
          </p>
        </div>
      </div>

      <div className={styles.grid}>
        {cards.map((card) => (
          <div key={card.id} className={styles.card}>
            <Link
              to={`${ROUTES.PRODUCTS}?category=${encodeURIComponent(card.categorySlug)}`}
              className={styles.imageLink}
            >
              <div className={styles.imageContainer}>
                <img
                  src={card.image}
                  alt={card.title}
                  className={styles.image}
                  loading="lazy"
                />
                <div className={styles.badgeGroup}>
                  {card.tag && <span className={styles.tagBadge}>{card.tag}</span>}
                  <span className={styles.discountBadge}>{card.discount}</span>
                </div>
              </div>
            </Link>

            <div className={styles.cardContent}>
              <div className={styles.ratingRow}>
                <span className={styles.starIcon} aria-hidden="true">
                  <Star size={13} fill="#f59e0b" color="#f59e0b" />
                </span>
                <span className={styles.ratingVal}>{card.rating}</span>
                <span className={styles.reviewCount}>({card.reviews})</span>
              </div>

              <h3 className={styles.cardTitle}>
                <Link
                  to={`${ROUTES.PRODUCTS}?category=${encodeURIComponent(card.categorySlug)}`}
                  className={styles.titleLink}
                >
                  {card.title}
                </Link>
              </h3>

              {card.features && card.features.length > 0 && (
                <div className={styles.featuresList}>
                  {card.features.map((feat, idx) => (
                    <span key={idx} className={styles.featureItem}>
                      <span className={styles.featureDot} />
                      {feat}
                    </span>
                  ))}
                </div>
              )}

              <div className={styles.priceRow}>
                <span className={styles.salePrice}>{card.salePrice}</span>
                <span className={styles.originalPrice}>{card.originalPrice}</span>
                <span className={styles.savePercent}>40% Off</span>
              </div>

              <Link
                to={`${ROUTES.PRODUCTS}?category=${encodeURIComponent(card.categorySlug)}`}
                className={styles.shopButton}
              >
                <Gift size={14} aria-hidden="true" />
                <span>Personalize Now</span>
              </Link>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
