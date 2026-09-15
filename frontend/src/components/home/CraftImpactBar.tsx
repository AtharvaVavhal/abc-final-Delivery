import { Users, MapPin, Camera, HeartHandshake } from 'lucide-react'
import styles from './CraftImpactBar.module.css'

const METRICS = [
  {
    id: 'customers',
    icon: Users,
    value: '1 Million+',
    label: 'Happy Customers',
    subtext: 'Celebrating special bonds & milestones',
  },
  {
    id: 'cities',
    icon: MapPin,
    value: '3,500+',
    label: 'Cities Covered',
    subtext: 'Delivering surprise packages across India',
  },
  {
    id: 'followers',
    icon: Camera,
    value: '244k+',
    label: 'Social Community',
    subtext: 'Sharing love, unboxing & craft reels',
  },
  {
    id: 'madeinindia',
    icon: HeartHandshake,
    value: '100%',
    label: 'Handcrafted In India',
    subtext: 'Artisan studio precision & premium materials',
    flag: true,
  },
]

export function CraftImpactBar() {
  return (
    <section className={styles.section} aria-labelledby="craft-impact-heading">
      <div className={styles.container}>
        <div className={styles.header}>
          <p className={styles.eyebrow}>Milestones & Community</p>
          <h2 id="craft-impact-heading" className={styles.title}>
            Crafted With Love, Trusted Across India
          </h2>
        </div>

        <div className={styles.grid}>
          {METRICS.map((metric) => {
            const Icon = metric.icon
            return (
              <div key={metric.id} className={styles.metricCard}>
                <div className={styles.iconContainer} aria-hidden="true">
                  <Icon size={24} className={styles.icon} />
                </div>
                <div className={styles.valueRow}>
                  <span className={styles.value}>{metric.value}</span>
                  {metric.flag && (
                    <span className={styles.flagBadge} title="Made in India">
                      🇮🇳
                    </span>
                  )}
                </div>
                <h3 className={styles.label}>{metric.label}</h3>
                <p className={styles.subtext}>{metric.subtext}</p>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
