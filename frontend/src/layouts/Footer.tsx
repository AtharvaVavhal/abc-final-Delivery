import { Link } from 'react-router-dom'
import { Printer } from 'lucide-react'
import { ROUTES } from '@/constants/routes'
import { useCategoryTree } from '@/hooks/useCategoryTree'
import { useStoreName } from '@/hooks/useStoreName'
import { useStoreContact } from '@/hooks/useStoreContact'
import { useWhatsappNumber } from '@/hooks/useWhatsappNumber'
import styles from './Footer.module.css'

const COMPANY_LINKS = [
  { label: 'About', to: ROUTES.ABOUT },
  { label: 'Contact', to: ROUTES.CONTACT },
] as const

const LEGAL_LINKS = [
  { label: 'Search', to: ROUTES.PRODUCTS },
  { label: 'Privacy', to: ROUTES.PRIVACY },
  { label: 'Terms', to: ROUTES.TERMS },
  { label: 'Refund Policy', to: ROUTES.REFUND_POLICY },
] as const

export function Footer() {
  const storeName = useStoreName()
  const contact = useStoreContact()
  const whatsapp = useWhatsappNumber()
  const { data: categoryTree = [] } = useCategoryTree()
  const shopLinks = [
    { label: 'All products', to: ROUTES.PRODUCTS },
    { label: 'Home', to: ROUTES.HOME },
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
            <Link to={ROUTES.HOME} className={styles.brand}>
              <span className={styles.brandIcon} aria-hidden="true">
                <Printer size={18} strokeWidth={2.2} />
              </span>
              <span>{storeName}</span>
            </Link>
            <p className={styles.tagline}>Custom prints, made to order.</p>
            <p className={styles.studioMotto}>
              Printed in the studio from the products published in Store Admin.
            </p>
          </div>

          <nav className={styles.columns} aria-label="Footer">
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
                {!contact.email && !contact.phone && !whatsapp ? (
                  <li className={styles.address}>
                    Contact details appear here when the store publishes them.
                  </li>
                ) : null}
              </ul>
            </div>
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
                {LEGAL_LINKS.map((link) => (
                  <li key={link.to}>
                    <Link to={link.to} className={styles.link}>
                      {link.label}
                    </Link>
                  </li>
                ))}
                {COMPANY_LINKS.map((link) => (
                  <li key={link.to}>
                    <Link to={link.to} className={styles.link}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            {hasContact ? (
              <div className={styles.column}>
                <h2 className={styles.columnHeading}>Contact Us</h2>
                <ul className={styles.columnList}>
                  {contact.address ? <li className={styles.address}>{contact.address}</li> : null}
                  {contact.phone ? <li className={styles.address}>{contact.phone}</li> : null}
                  {contact.email ? <li className={styles.address}>{contact.email}</li> : null}
                </ul>
              </div>
            ) : null}
          </nav>
        </div>

        <p className={styles.copyright}>
          &copy; {new Date().getFullYear()} {storeName}. All rights reserved.
        </p>
      </div>
    </footer>
  )
}
