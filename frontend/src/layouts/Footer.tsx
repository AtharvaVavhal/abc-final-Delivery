import { Link } from 'react-router-dom'
import { ROUTES } from '@/constants/routes'
import { useCategoryTree } from '@/hooks/useCategoryTree'
import { useStoreName } from '@/hooks/useStoreName'
import { STORE_LOGO_FALLBACK, useStoreLogo } from '@/hooks/useStoreLogo'
import { useStoreContact } from '@/hooks/useStoreContact'
import { useWhatsappNumber } from '@/hooks/useWhatsappNumber'
import styles from './Footer.module.css'

const QUICK_LINKS = [
  { label: 'About', to: ROUTES.ABOUT },
  { label: 'Contact', to: ROUTES.CONTACT },
  { label: 'Search', to: ROUTES.PRODUCTS },
  { label: 'Privacy', to: ROUTES.PRIVACY },
  { label: 'Terms', to: ROUTES.TERMS },
  { label: 'Refund Policy', to: ROUTES.REFUND_POLICY },
] as const

export function Footer() {
  const storeName = useStoreName()
  const storeLogo = useStoreLogo()
  const contact = useStoreContact()
  const whatsapp = useWhatsappNumber()
  const { data: categoryTree = [] } = useCategoryTree()
  const shopLinks = [
    { label: 'All products', to: ROUTES.PRODUCTS },
    ...categoryTree.slice(0, 6).map((category) => ({
      label: category.name,
      to: `${ROUTES.PRODUCTS}?categoryId=${encodeURIComponent(category.id)}`,
    })),
  ]

  const hasContact = Boolean(contact.email || contact.phone || contact.address || whatsapp)

  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.top}>
          <div className={styles.brandBlock}>
            <Link to={ROUTES.HOME} className={styles.brand} aria-label={`${storeName} home`}>
              <img
                src={storeLogo || STORE_LOGO_FALLBACK}
                alt=""
                className={styles.brandLogo}
                key={storeLogo || STORE_LOGO_FALLBACK}
              />
            </Link>
            <p className={styles.tagline}>Custom prints, made to order.</p>
          </div>

          <nav className={styles.columns} aria-label="Footer">
            {hasContact ? (
              <div className={styles.column}>
                <h2 className={styles.columnHeading}>Get in touch</h2>
                <ul className={styles.columnList}>
                  {contact.email ? (
                    <li>
                      <a className={styles.link} href={`mailto:${contact.email}`}>
                        {contact.email}
                      </a>
                    </li>
                  ) : null}
                  {contact.phone ? (
                    <li>
                      <a className={styles.link} href={`tel:${contact.phone.replace(/\s/g, '')}`}>
                        {contact.phone}
                      </a>
                    </li>
                  ) : null}
                  {whatsapp ? (
                    <li>
                      <a
                        className={styles.link}
                        href={`https://wa.me/${whatsapp}`}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        WhatsApp
                      </a>
                    </li>
                  ) : null}
                  {contact.address ? <li className={styles.address}>{contact.address}</li> : null}
                </ul>
              </div>
            ) : null}
            <div className={styles.column}>
              <h2 className={styles.columnHeading}>Shop</h2>
              <ul className={styles.columnList}>
                {shopLinks.map((link) => (
                  <li key={link.to + link.label}>
                    <Link to={link.to} className={styles.link}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div className={styles.column}>
              <h2 className={styles.columnHeading}>Quick Links</h2>
              <ul className={styles.columnList}>
                {QUICK_LINKS.map((link) => (
                  <li key={link.to}>
                    <Link to={link.to} className={styles.link}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </nav>
        </div>

        <p className={styles.copyright}>
          &copy; {new Date().getFullYear()} {storeName}. All rights reserved.
        </p>
      </div>
    </footer>
  )
}
