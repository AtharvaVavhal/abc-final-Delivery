import { useId } from 'react'
import { ChevronRight, RefreshCw } from 'lucide-react'
import { cn } from '@/utils/cn'
import { AbGlowMark } from './AbGlowMark'
import styles from './illos-maintenance-page.module.css'

/** Maintenance page: dark, glowing AB monogram, one short message, a way to
 * recheck and (only when the store has published one) a way to reach the store.
 * Deliberately no simulated progress, time estimates or email collection: the
 * backend has no end time or notify endpoint, so showing them would be made-up.
 */
export interface IllosMaintenancePageProps {
  storeName?: string | null
  title?: string
  description?: string
  /** wa.me / mailto: / tel: link built from the store's published contact
   * settings. Omit and the "Contact us" link is not rendered. */
  contactHref?: string
  onRetry: () => void
  isChecking?: boolean
  error?: string
  className?: string
}

export function IllosMaintenancePage({
  storeName,
  title = 'We’ll be right back.',
  description = 'We’re making updates to the AB CREATIONS store. Check back soon.',
  contactHref,
  onRetry,
  isChecking = false,
  error,
  className,
}: IllosMaintenancePageProps) {
  const titleId = useId()
  const isExternal = contactHref?.startsWith('https://')

  return (
    <main className={cn(styles.page, className)} aria-labelledby={titleId}>
      <div className={styles.center}>
        <AbGlowMark className={styles.mark} label={storeName?.trim() || 'AB Creations'} />
        <h1 id={titleId} className={styles.title}>
          {title}
        </h1>
        <p className={styles.description}>{description}</p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.retry}
            onClick={onRetry}
            disabled={isChecking}
            aria-busy={isChecking}
          >
            {!isChecking && <RefreshCw size={16} aria-hidden="true" />}
            {isChecking ? 'Checking availability…' : 'Check again'}
          </button>
          {contactHref && (
            <a
              className={styles.contact}
              href={contactHref}
              {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            >
              Contact us
              <ChevronRight size={18} aria-hidden="true" />
            </a>
          )}
        </div>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
      </div>
      <footer className={styles.footer}>
        <p className={styles.location}>AB CREATIONS GWL · Gwalior, Madhya Pradesh, India</p>
        <a
          className={styles.credit}
          href="https://forgebuilds.in"
          target="_blank"
          rel="noopener noreferrer"
        >
          <span>A product of</span>
          <img
            className={styles.creditLogo}
            src="/brand/forge/FORGE-horizontal-white-on-ink.png"
            alt="FORGE"
            width={300}
            height={62}
          />
        </a>
        <a className={styles.adminLink} href="/login">
          Store admin sign in
        </a>
      </footer>
    </main>
  )
}

export default IllosMaintenancePage
