import { ShieldCheck, Palette, PackageSearch } from 'lucide-react'
import { useStoreName } from '@/hooks/useStoreName'
import styles from './TrustStrip.module.css'

/**
 * Value props — restricted to capabilities this application actually
 * implements. No delivery timelines, return windows, tax claims, or
 * certifications are stated here; none of those are backed by real data or
 * policy in the codebase.
 */
const ITEMS = [
  {
    icon: ShieldCheck,
    title: 'Secure checkout',
    text: 'Payments are handled by Razorpay. Card and UPI details never touch PrintForge servers.',
  },
  {
    icon: Palette,
    title: 'Made to order',
    text: 'Add text, colors, and uploads on products that support customization — each item is printed for your order.',
  },
  {
    icon: PackageSearch,
    title: 'Track every order',
    text: 'Follow order status from your account and download an invoice once payment is confirmed.',
  },
] as const

export function TrustStrip() {
  const storeName = useStoreName()

  return (
    <section className={styles.section} aria-labelledby="home-trust-heading">
      <h2 id="home-trust-heading" className="srOnly">
        Why shop with {storeName}
      </h2>
      <ul className={styles.grid}>
        {ITEMS.map(({ icon: Icon, title, text }) => (
          <li key={title} className={styles.item}>
            <Icon className={styles.icon} size={24} aria-hidden="true" />
            <div>
              <p className={styles.itemTitle}>{title}</p>
              <p className={styles.itemText}>{text}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
