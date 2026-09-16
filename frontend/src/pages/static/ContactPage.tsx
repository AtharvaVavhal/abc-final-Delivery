import { Alert } from '@/components/ui/Alert'
import { Seo } from '@/seo/Seo'
import { ROUTES } from '@/constants/routes'
import { useStoreContact } from '@/hooks/useStoreContact'
import { useWhatsappNumber } from '@/hooks/useWhatsappNumber'
import { useStoreName } from '@/hooks/useStoreName'
import { CONTACT_DESCRIPTION } from '@/seo/pageCopy'
import styles from './ContactPage.module.css'

export function ContactPage() {
  const storeName = useStoreName()
  const contact = useStoreContact()
  const whatsapp = useWhatsappNumber()
  const hasDirect = Boolean(contact.email || contact.phone || contact.address)

  return (
    <section className={styles.page}>
      <Seo
        title="Contact"
        description={CONTACT_DESCRIPTION(storeName)}
        canonicalPath={ROUTES.CONTACT}
      />
      <h1>Contact Us</h1>
      <p className={styles.intro}>
        Reach {storeName} using the details the store has published. Nothing here is invented —
        unpublished fields stay hidden.
      </p>

      {hasDirect ? (
        <ul className={styles.details}>
          {contact.address ? <li>{contact.address}</li> : null}
          {contact.phone ? (
            <li>
              <a href={`tel:${contact.phone.replace(/\s/g, '')}`}>{contact.phone}</a>
            </li>
          ) : null}
          {contact.email ? (
            <li>
              <a href={`mailto:${contact.email}`}>{contact.email}</a>
            </li>
          ) : null}
        </ul>
      ) : (
        <Alert variant="info">
          <strong>WhatsApp chat.</strong> Open the chat button on any storefront page once the store
          WhatsApp number is configured in Admin → Settings. Email, phone, and a contact form are
          not published here until those details are confirmed.
        </Alert>
      )}

      {whatsapp ? (
        <p className={styles.intro}>
          <a href={`https://wa.me/${whatsapp}`} rel="noopener noreferrer" target="_blank">
            Chat on WhatsApp
          </a>
        </p>
      ) : null}
    </section>
  )
}
