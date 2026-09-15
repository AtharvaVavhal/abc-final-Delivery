import { Link } from 'react-router-dom'
import { Layers, Sparkles } from 'lucide-react'
import { useCategoryTree } from '@/hooks/useCategoryTree'
import { sortCategoryTree } from '@/features/catalog/categoryNavOrder'
import { ROUTES } from '@/constants/routes'
import styles from './OccasionBar.module.css'

export function OccasionBar() {
  const { data: tree = [], isPending, isError } = useCategoryTree()
  const groups = sortCategoryTree(tree)

  if (isError || isPending || groups.length === 0) {
    return null
  }

  return (
    <section
      className={styles.container}
      aria-labelledby="home-categories-heading"
    >
      <div className={styles.inner}>
        <div className={styles.titleWrapper}>
          <span className={styles.titleIcon} aria-hidden="true">
            <Sparkles size={16} />
          </span>
          <span id="home-categories-heading" className={styles.titleText}>
            Shop by category
          </span>
        </div>

        <div className={styles.scrollWrapper}>
          <div className={styles.chipTrack} role="list">
            <div role="listitem" className={styles.chipWrapper}>
              <Link to={ROUTES.PRODUCTS} className={styles.chip}>
                <Layers size={16} className={styles.chipIcon} aria-hidden="true" />
                <span className={styles.chipLabel}>All products</span>
              </Link>
            </div>
            {groups.map((category) => (
              <div key={category.id} role="listitem" className={styles.chipWrapper}>
                <Link
                  to={`${ROUTES.PRODUCTS}?categoryId=${encodeURIComponent(category.id)}`}
                  className={styles.chip}
                >
                  <span className={styles.chipLabel}>{category.name}</span>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
