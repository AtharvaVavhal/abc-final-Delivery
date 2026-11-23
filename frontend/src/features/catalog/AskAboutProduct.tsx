import { useWhatsappNumber } from '@/hooks/useWhatsappNumber'
import styles from './AskAboutProduct.module.css'

/** "Ask about this design" link on the product page. Opens WhatsApp with a
 * message that names the product and links to it, so the team knows what the
 * customer is asking about. Renders nothing when no WhatsApp number is
 * configured (same rule as the floating button). */
export function AskAboutProduct({
  productName,
  productUrl,
}: {
  productName: string
  productUrl: string
}) {
  const number = useWhatsappNumber()
  if (!number) return null

  const message = `Hi! I'd like to know more about "${productName}" before ordering.\n${productUrl}`
  const href = `https://wa.me/${number}?text=${encodeURIComponent(message)}`

  return (
    <a className={styles.link} href={href} target="_blank" rel="noopener noreferrer">
      Questions about this design? Ask us on WhatsApp
    </a>
  )
}
