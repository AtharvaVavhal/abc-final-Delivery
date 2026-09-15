import { Palette, Headphones, PackageSearch, ShieldCheck } from 'lucide-react'
import { useStoreName } from '@/hooks/useStoreName'
import styles from './CraftPillars.module.css'

const PILLARS = [
  {
    id: 'custom',
    icon: Palette,
    stat: 'Made to order',
    title: 'Product customization',
    description:
      'Add text, colors, and file uploads on products that include those options in the catalog.',
    accent: '#e50b0b',
  },
  {
    id: 'support',
    icon: Headphones,
    stat: 'WhatsApp',
    title: 'Store chat',
    description:
      'Use the storefront chat button when a WhatsApp number is configured in store settings.',
    accent: '#3b82f6',
  },
  {
    id: 'orders',
    icon: PackageSearch,
    stat: 'Account orders',
    title: 'Track every order',
    description:
      'Follow status from your account and download an invoice after payment is confirmed.',
    accent: '#10b981',
  },
  {
    id: 'checkout',
    icon: ShieldCheck,
    stat: 'Razorpay',
    title: 'Secure checkout',
    description:
      'Card and UPI details are handled by Razorpay and never stored on this storefront.',
    accent: '#f59e0b',
  },
]

export function CraftPillars() {
  const storeName = useStoreName()
  return (
    <section className={styles.section} aria-labelledby="craft-pillars-heading">
      <div className={styles.container}>
        <div className={styles.header}>
          <p className={styles.eyebrow}>{storeName}</p>
          <h2 id="craft-pillars-heading" className={styles.title}>
            Shopping with {storeName}
          </h2>
          <p className={styles.subtitle}>
            Capabilities this storefront actually supports — not invented ratings or delivery promises.
          </p>
        </div>

        <div className={styles.grid}>
          {PILLARS.map((pillar) => {
            const Icon = pillar.icon
            return (
              <div key={pillar.id} className={styles.card}>
                <div
                  className={styles.iconWrapper}
                  style={{ backgroundColor: `${pillar.accent}14`, color: pillar.accent }}
                  aria-hidden="true"
                >
                  <Icon size={26} strokeWidth={2} />
                </div>
                <div className={styles.stat}>{pillar.stat}</div>
                <h3 className={styles.cardTitle}>{pillar.title}</h3>
                <p className={styles.description}>{pillar.description}</p>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
