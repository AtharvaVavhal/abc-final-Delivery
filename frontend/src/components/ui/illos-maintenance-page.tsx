import { useEffect, useId, useRef, type CSSProperties } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from './Button'
import { cn } from '@/utils/cn'
import { MIGRATION_SVG } from './illos-migration-art'
import styles from './illos-maintenance-page.module.css'

/** CSS-module adaptation of the Illos maintenance page layout (MIT), with the
 * Illos "Database migration" illustration (Illos free license, see
 * illos-migration-art.ts). Deliberately no simulated progress, time estimates
 * or email collection: the backend has no end time or notify endpoint, so
 * showing them would be made-up.
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
      <div className={styles.layout}>
        <div className={styles.well}>
          <IsoArt svg={MIGRATION_SVG} className={styles.art} />
        </div>
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
              . Also from FORGE: Nook, bed-level inventory for buildings.
            </span>
          </p>
        </div>
      </div>
    </main>
  )
}

/** The illustration, inline. Decorative: the page text says what is happening. */
function IsoArt({ svg, className }: { svg: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const host = ref.current
    if (!host) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    if (typeof IntersectionObserver === 'undefined') {
      host.style.setProperty('--illos-play', 'running')
      return
    }
    // Plays while a quarter is in view, pauses off screen.
    const io = new IntersectionObserver(
      (entries) =>
        host.style.setProperty(
          '--illos-play',
          entries.some((e) => e.isIntersecting) ? 'running' : 'paused',
        ),
      { threshold: 0.25 },
    )
    io.observe(host)
    return () => io.disconnect()
  }, [])
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={className}
      style={{ '--illos-play': 'paused' } as CSSProperties}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

export default IllosMaintenancePage
