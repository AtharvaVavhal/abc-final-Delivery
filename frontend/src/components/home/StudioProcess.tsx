import { Layers, Sliders, Truck, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ROUTES } from '@/constants/routes'
import styles from './StudioProcess.module.css'

const STEPS = [
  {
    step: '01',
    icon: Layers,
    title: 'Select Your Canvas',
    description:
      'Explore our catalog of premium mugs, t-shirts, business cards, photo frames, and laser-cut name plates.',
    badge: 'Curated blanks',
  },
  {
    step: '02',
    icon: Sliders,
    title: 'Personalize & Upload',
    description:
      'Add custom typography, upload your company logo or high-res artwork, and choose your preferred sizes and finishes.',
    badge: 'Live customizer',
  },
  {
    step: '03',
    icon: Truck,
    title: 'Studio Crafted & Delivered',
    description:
      'Every order is inspected by our printmakers, crafted with studio precision, and delivered straight to your door.',
    badge: '48–72h turnaround',
  },
] as const

export function StudioProcess() {
  return (
    <section className={styles.section} aria-labelledby="studio-process-heading">
      <div className={styles.container}>
        <div className={styles.header}>
          <p className={styles.eyebrow}>Seamless Workflow</p>
          <h2 id="studio-process-heading" className={styles.title}>
            How Custom Printing Works
          </h2>
          <p className={styles.subtitle}>
            From your digital idea to a physical masterpiece in 3 simple steps.
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
