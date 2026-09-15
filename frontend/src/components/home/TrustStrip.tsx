import { ShieldCheck, Palette, PackageSearch } from 'lucide-react'
import { useStoreName } from '@/hooks/useStoreName'
import styles from './TrustStrip.module.css'

/**
 * Value props — restricted to capabilities this application actually
 * implements. No delivery timelines, return windows, tax claims, or
 * order-volume statistics.
 */
export function TrustStrip() {
  const storeName = useStoreName()
  const items = [
    {
      icon: ShieldCheck,
      title: 'Secure checkout',
      text: `Payments go through Razorpay. Card and UPI details never touch ${storeName} servers.`,
    },
    {
      icon: Palette,
      title: 'Send a photo, we print it',
      text: 'Customise products that support it — each piece is printed for your order.',
    },
    {
      icon: PackageSearch,
      title: 'Track every order',
      text: 'Follow status from your account and download an invoice after payment.',
    },
  ] as const

  return (
    <section className={styles.section} aria-labelledby="home-trust-heading">
      <h2 id="home-trust-heading" className="srOnly">
        Why shop with {storeName}
      </h2>
      <ul className={styles.grid}>
        {items.map(({ icon: Icon, title, text }) => (
          <li key={title} className={styles.item}>
            <Icon className={styles.icon} size={22} aria-hidden="true" />
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
