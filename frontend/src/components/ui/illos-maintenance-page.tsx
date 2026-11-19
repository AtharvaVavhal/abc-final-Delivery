import { useId } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from './Button'
import { cn } from '@/utils/cn'
import styles from './illos-maintenance-page.module.css'

/** CSS-module adaptation of the supplied MIT-licensed component layout.
 * No Illos artwork, simulated progress, time estimates, or email collection.
 */
export interface IllosMaintenancePageProps {
  storeName?: string | null
  status?: string
  title?: string
  description?: string
  onRetry: () => void
  isChecking?: boolean
  error?: string
  className?: string
}

export function IllosMaintenancePage({
  storeName,
  status = 'Maintenance in progress',
  title = 'We’re taking a short break.',
  description = 'The store is temporarily unavailable while we carry out maintenance. Please check back later.',
  onRetry,
  isChecking = false,
  error,
  className,
}: IllosMaintenancePageProps) {
  const titleId = useId()

  return (
    <main className={cn(styles.page, className)} aria-labelledby={titleId}>
      <div className={styles.content}>
        <p className={styles.brand}>{storeName?.trim() || 'AB Creations'}</p>
        <div className={styles.message}>
          <p className={styles.status}>
            <span className={styles.dot} aria-hidden="true" />
            {status}
          </p>
          <h1 id={titleId} className={styles.title}>
            {title}
          </h1>
          <p className={styles.description}>{description}</p>
        </div>
        <div className={styles.actions}>
          <Button onClick={onRetry} isLoading={isChecking}>
            <span className={styles.buttonLabel}>
              {!isChecking && <RefreshCw size={16} aria-hidden="true" />}
              {isChecking ? 'Checking availability…' : 'Check again'}
            </span>
          </Button>
          <p className={styles.hint}>
            This page checks automatically while it’s open.
          </p>
        </div>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <a className={styles.adminLink} href="/login">
          Store admin sign in
        </a>
      </div>
    </main>
  )
}

export default IllosMaintenancePage
