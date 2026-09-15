import { Layers, Sliders, Truck, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ROUTES } from '@/constants/routes'
import styles from './StudioProcess.module.css'

const STEPS = [
  {
    step: '01',
    icon: Layers,
    title: 'Pick a product',
    description: 'Choose an acrylic gift, mug, clock, or corporate piece from the catalog.',
    badge: 'Catalog',
  },
  {
    step: '02',
    icon: Sliders,
    title: 'Send your photo',
    description: 'Upload the picture or text that product asks for. We print from what you send.',
    badge: 'Your files',
  },
  {
    step: '03',
    icon: Truck,
    title: 'We print and ship',
    description: 'Pay on Razorpay. Production starts after payment — typically 3–5 working days.',
    badge: 'Made to order',
  },
] as const

export function StudioProcess() {
  return (
    <section className={styles.section} aria-labelledby="studio-process-heading">
      <div className={styles.container}>
        <div className={styles.header}>
          <p className={styles.eyebrow}>How ordering works</p>
          <h2 id="studio-process-heading" className={styles.title}>
            How it works
          </h2>
          <p className={styles.subtitle}>
            Send a photo. We print it. You track the order from your account.
          </p>
        </div>

        <div className={styles.grid}>
          {STEPS.map(({ step, icon: Icon, title, description, badge }) => (
            <div key={step} className={styles.card}>
              <div className={styles.cardTop}>
                <span className={styles.stepNumber}>{step}</span>
                <span className={styles.badge}>{badge}</span>
              </div>
              <div className={styles.iconWrapper} aria-hidden="true">
                <Icon size={26} strokeWidth={1.8} className={styles.icon} />
              </div>
              <h3 className={styles.cardTitle}>{title}</h3>
              <p className={styles.cardDescription}>{description}</p>
            </div>
          ))}
        </div>

        <div className={styles.ctaRow}>
          <Link to={ROUTES.PRODUCTS} className={styles.ctaButton}>
            <span>Start your custom order</span>
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  )
}
