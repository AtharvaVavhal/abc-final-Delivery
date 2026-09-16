import { Check, MapPin } from 'lucide-react'
import { cn } from '@/utils/cn'
import styles from './HeaderTrustBar.module.css'

export interface SellerIdentityStripProps {
  legalName: string
  locality: string
  gstin: string
  paymentProtected: boolean
  /** Admin settings preview — same strip, labelled separately. */
  compact?: boolean
}

export function SellerIdentityStrip({
  legalName,
  locality,
  gstin,
  paymentProtected,
  compact = false,
}: SellerIdentityStripProps) {
  if (!legalName && !locality && !gstin && !paymentProtected) {
    return null
  }

  return (
    <div
      className={cn(styles.bar, compact && styles.compact)}
      role="region"
      aria-label={compact ? 'Navbar preview' : 'Seller identity'}
    >
      <div className={styles.inner}>
        {(legalName || locality) && (
          <div className={styles.seller}>
            {legalName ? <p className={styles.name}>{legalName}</p> : null}
            {locality ? (
              <p className={styles.locality}>
                <MapPin size={14} strokeWidth={2} aria-hidden="true" />
                <span>{locality}</span>
              </p>
            ) : null}
          </div>
        )}

        <div className={styles.badges}>
          {gstin ? (
            <p className={styles.badge}>
              <span className={styles.badgeIcon} aria-hidden="true">
                <Check size={11} strokeWidth={3} />
              </span>
              <span>
                GST No. <span className={styles.gstin}>{gstin}</span>
              </span>
            </p>
          ) : null}
          {paymentProtected ? (
            <p className={styles.badge}>
              <span className={styles.badgeIcon} aria-hidden="true">
                <Check size={11} strokeWidth={3} />
              </span>
              <span>Payment Protected</span>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
