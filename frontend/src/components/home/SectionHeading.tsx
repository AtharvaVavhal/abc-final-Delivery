import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import styles from './SectionHeading.module.css'

interface SectionHeadingProps {
  id: string
  title: string
  subtitle?: string
  /** Optional "see the full list" affordance — omitted for sections that
   * are already the whole set (e.g. the trust strip). */
  viewAllHref?: string
  viewAllLabel?: string
}

/** Shared storefront section header — one title style, one "view all"
 * affordance, used by every homepage rail so spacing and typography stay
 * consistent. */
export function SectionHeading({
  id,
  title,
  subtitle,
  viewAllHref,
  viewAllLabel = 'View all',
}: SectionHeadingProps) {
  return (
    <div className={styles.row}>
      <div>
        <h2 id={id} className={styles.title}>
          {title}
        </h2>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
      </div>
      {viewAllHref && (
        <Link to={viewAllHref} className={styles.viewAll}>
          {viewAllLabel}
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      )}
    </div>
  )
}
