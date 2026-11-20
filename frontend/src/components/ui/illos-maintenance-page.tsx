import { useId } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from './Button'
import { cn } from '@/utils/cn'
import { STORE_LOGO_FALLBACK } from '@/hooks/useStoreLogo'
import styles from './illos-maintenance-page.module.css'

/** Maintenance page in the store's own branding: store logo, workshop photo and
 * the FORGE credit. Deliberately no simulated progress, time estimates or email
 * collection: the backend has no end time or notify endpoint, so showing them
 * would be made-up.
 */
export interface IllosMaintenancePageProps {
  storeName?: string | null
  logoUrl?: string | null
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
  logoUrl,
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
      <div className={styles.layout}>
        <div className={styles.well}>
          <img
            className={styles.photo}
            src="/catalog/about.jpg"
            alt=""
            aria-hidden="true"
            width={1200}
            height={800}
          />
        </div>
        <div className={styles.content}>
          <img
            className={styles.brandLogo}
            src={logoUrl?.trim() || STORE_LOGO_FALLBACK}
            alt={storeName?.trim() || 'AB Creations'}
          />
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
          <p className={styles.credit}>
            <img
              className={styles.creditLogo}
              src="/brand/forge/FORGE-horizontal.png"
              alt="FORGE Technologies"
              width={300}
              height={62}
            />
            <span>
              Designed &amp; Managed by{' '}
              <a
                className={styles.creditLink}
                href="https://forgebuilds.in"
                target="_blank"
                rel="noopener noreferrer"
              >
                FORGE Technologies
              </a>
              . Also from FORGE:{' '}
              <img className={styles.nookLogo} src="/brand/nook/nook-logo.svg" alt="Nook" width={394} height={142} />
              {' '}bed-level inventory for buildings.
            </span>
          </p>
        </div>
      </div>
    </main>
  )
}

export default IllosMaintenancePage
