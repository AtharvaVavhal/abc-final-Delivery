import { Link } from 'react-router-dom'
import { Printer } from 'lucide-react'
import { ROUTES } from '@/constants/routes'
import { useStoreName } from '@/hooks/useStoreName'
import styles from './Footer.module.css'

/**
 * Only routes that actually exist are linked. No social accounts, phone
 * numbers, postal address, payment badges, or company statistics are
 * shown — none of those exist in this application.
 */
const COLUMNS: { heading: string; links: { label: string; to: string }[] }[] = [
  {
    heading: 'Shop',
    links: [
      { label: 'All products', to: ROUTES.PRODUCTS },
      { label: 'Home', to: ROUTES.HOME },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'About', to: ROUTES.ABOUT },
      { label: 'Contact', to: ROUTES.CONTACT },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { label: 'Privacy', to: ROUTES.PRIVACY },
      { label: 'Terms', to: ROUTES.TERMS },
      { label: 'Refund Policy', to: ROUTES.REFUND_POLICY },
    ],
  },
]

export function Footer() {
  const storeName = useStoreName()

  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.top}>
          <div className={styles.brandBlock}>
            <Link to={ROUTES.HOME} className={styles.brand}>
              <span className={styles.brandIcon} aria-hidden="true">
                <Printer size={18} strokeWidth={2.2} />
              </span>
              <span>{storeName}</span>
            </Link>
            <p className={styles.tagline}>Custom prints, made to order.</p>
            <p className={styles.studioMotto}>Handcrafted in our local print studio. Precision quality on every order.</p>
          </div>

          <nav className={styles.columns} aria-label="Footer">
            {COLUMNS.map((column) => (
              <div key={column.heading} className={styles.column}>
                <h2 className={styles.columnHeading}>{column.heading}</h2>
                <ul className={styles.columnList}>
                  {column.links.map((link) => (
                    <li key={link.to}>
                      <Link to={link.to} className={styles.link}>
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <p className={styles.copyright}>
          &copy; {new Date().getFullYear()} {storeName}. All rights reserved.
        </p>
      </div>
    </footer>
  )
}
