import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ROUTES } from '@/constants/routes'
import { Seo } from '@/seo/Seo'
import styles from './OtpLoginShell.module.css'

const asset = '/brand/ab-creations/login'
const variants = (ext: string) =>
  [640, 960, 1440]
    .map((w) => `${asset}/portrait-lamp-${w}.${ext} ${w}w`)
    .join(', ')

export function OtpLoginShell({
  children,
  footer,
}: {
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className={styles.page}>
      <Seo title="Sign in | AB CREATIONS" noindex />
      <aside className={styles.hero} aria-label="Made personal, made for you">
        <picture>
          <source
            media="(min-width: 769px)"
            type="image/avif"
            srcSet={variants('avif')}
            sizes="50vw"
          />
          <source
            media="(min-width: 769px)"
            type="image/webp"
            srcSet={variants('webp')}
            sizes="50vw"
          />
          {/* A tiny inline fallback avoids downloading the hidden hero on mobile. */}
          <img
            className={styles.heroImage}
            src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="
            width={1856}
            height={2304}
            fetchPriority="high"
            alt="Warmly illuminated acrylic portrait lamp on a walnut base"
          />
        </picture>
        <p className={styles.tagline}>
          MADE PERSONAL.
          <br />
          MADE <span>FOR YOU.</span>
        </p>
      </aside>
      <section className={styles.auth} aria-label="AB CREATIONS sign in">
        <div className={styles.card}>
          <Link
            to={ROUTES.HOME}
            className={styles.logoLink}
            aria-label="AB CREATIONS home"
          >
            <img
              src={`${asset}/logo-dark.svg`}
              width={278}
              height={62}
              className={styles.logo}
              alt="AB CREATIONS"
            />
          </Link>
          {children}
          <p className={styles.legal}>
            By continuing, you agree to AB CREATIONS&apos;
            <br className={styles.legalBreak} />{' '}
            <Link to={ROUTES.TERMS}>Terms &amp; Conditions</Link> and{' '}
            <Link to={ROUTES.PRIVACY}>Privacy Policy</Link>.
          </p>
        </div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </section>
    </div>
  )
}
