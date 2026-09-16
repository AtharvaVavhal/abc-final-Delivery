import { Printer, Sparkles, CheckCircle2, Shield } from 'lucide-react'
import { useStoreName } from '@/hooks/useStoreName'
import styles from './StudioStandards.module.css'

export function StudioStandards() {
  const storeName = useStoreName()
  const standards = [
    {
      icon: Printer,
      title: 'Studio printing',
      description:
        `${storeName} prints each order from the product you selected and any customization you submitted with it.`,
    },
    {
      icon: Sparkles,
      title: 'Catalog-driven options',
      description:
        'Finishes, variants, and upload requirements come from the product record — not a one-size-fits-all form.',
    },
    {
      icon: CheckCircle2,
      title: 'File-based customization',
      description:
        'When a product asks for artwork, you upload it on that product page before checkout.',
    },
    {
      icon: Shield,
      title: 'Secure payment',
      description:
        'Checkout uses Razorpay. Card and UPI details never pass through store servers.',
    },
  ] as const

  return (
    <section className={styles.section} aria-labelledby="studio-standards-heading">
      <div className={styles.container}>
        <div className={styles.header}>
          <p className={styles.eyebrow}>{storeName}</p>
          <h2 id="studio-standards-heading" className={styles.title}>
            How this store works
          </h2>
          <p className={styles.subtitle}>
            Process copy only — no invented materials, ratings, or delivery guarantees.
          </p>
        </div>

        <div className={styles.grid}>
          {standards.map(({ icon: Icon, title, description }) => (
            <div key={title} className={styles.card}>
              <div className={styles.iconBox} aria-hidden="true">
                <Icon size={22} className={styles.icon} strokeWidth={2} />
              </div>
              <h3 className={styles.cardTitle}>{title}</h3>
              <p className={styles.cardDescription}>{description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
