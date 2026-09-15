import { Star, Headphones, Clock, ShieldCheck } from 'lucide-react'
import { useStoreName } from '@/hooks/useStoreName'
import styles from './CraftPillars.module.css'

const PILLARS = [
  {
    id: 'reviews',
    icon: Star,
    stat: '4,000+',
    title: '5 Star Reviews',
    description: 'Cherished by delighted gift givers across India with verified 5-star ratings.',
    accent: '#f59e0b',
  },
  {
    id: 'support',
    icon: Headphones,
    stat: 'Responsive',
    title: 'Customer Support',
    description: 'Direct WhatsApp and specialist assistance for custom previews and questions.',
    accent: '#3b82f6',
  },
  {
    id: 'delivery',
    icon: Clock,
    stat: 'On Time Delivery',
    title: 'Assurance Across India',
    description: 'Padded multi-layer protection and reliable carrier dispatch straight to your door.',
    accent: '#10b981',
  },
  {
    id: 'privacy',
    icon: ShieldCheck,
    stat: 'Data & Photo Privacy',
    title: 'Guaranteed Safe',
    description: '100% confidential media processing — your family memories remain strictly private.',
    accent: '#e50b0b',
  },
]

export function CraftPillars() {
  const storeName = useStoreName()
  return (
    <section className={styles.section} aria-labelledby="craft-pillars-heading">
      <div className={styles.container}>
        <div className={styles.header}>
          <p className={styles.eyebrow}>{storeName} Studio Promise</p>
          <h2 id="craft-pillars-heading" className={styles.title}>
            Why Customers Love Us
          </h2>
          <p className={styles.subtitle}>
            Dedicated to creating memorable, emotional, and timeless personalized keepsakes.
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
