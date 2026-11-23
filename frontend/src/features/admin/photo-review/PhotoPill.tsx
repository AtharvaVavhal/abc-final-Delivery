import type { PhotoReviewSummary } from '@/types/orders'
import { PHOTO_DOT, PHOTO_SUMMARY_LABELS } from './photoReviewLabels'
import styles from './PhotoReview.module.css'

/** Dot + word, like the other status pills: the colour never carries the
 * meaning alone. Renders a quiet dash when there is no photo. */
export function PhotoPill({ summary }: { summary: PhotoReviewSummary }) {
  if (summary === 'NONE') return <span className={styles.none}>—</span>
  return (
    <span className={styles.pill}>
      <span className={styles.dot} style={{ background: PHOTO_DOT[summary] }} aria-hidden="true" />
      {PHOTO_SUMMARY_LABELS[summary]}
    </span>
  )
}
