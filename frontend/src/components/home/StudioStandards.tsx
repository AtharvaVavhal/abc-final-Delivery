import { Printer, Sparkles, CheckCircle2, Shield } from 'lucide-react'
import styles from './StudioStandards.module.css'

const STANDARDS = [
  {
    icon: Printer,
    title: 'Precision Micro-Pigment Tech',
    description:
      'Ultra-dense pigment and dye-sublimation printing ensure laser-sharp vector edges, deep blacks, and true-to-life CMYK brilliance.',
  },
  {
    icon: Sparkles,
    title: 'Architectural-Grade Substrates',
    description:
      'From optical-clarity cast acrylic to heavyweight 350 GSM cotton-feel cardstock and microwave-safe ceramics, we never compromise on materials.',
  },
  {
    icon: CheckCircle2,
    title: 'Printmaker Pre-Press Review',
    description:
      'Our studio specialists review resolution, trim lines, bleed margins, and color profiles on every custom artwork file before initiating print.',
  },
  {
    icon: Shield,
    title: 'Damage-Free Delivery Guarantee',
    description:
      'Custom-engineered rigid mailers and shock-absorbing foam inserts keep delicate acrylics, ceramics, and prints perfectly protected in transit.',
  },
] as const

export function StudioStandards() {
  return (
    <section className={styles.section} aria-labelledby="studio-standards-heading">
      <div className={styles.container}>
        <div className={styles.header}>
          <p className={styles.eyebrow}>Artisan Reliability</p>
          <h2 id="studio-standards-heading" className={styles.title}>
            The PrintForge Standard
          </h2>
          <p className={styles.subtitle}>
            Every custom piece is crafted with meticulous attention to detail, uncompromising materials, and studio-grade equipment.
          </p>
        </div>

        <div className={styles.grid}>
          {STANDARDS.map(({ icon: Icon, title, description }) => (
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
