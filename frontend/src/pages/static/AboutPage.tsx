import { Seo } from '@/seo/Seo'
import { ROUTES } from '@/constants/routes'
import { ABOUT_DESCRIPTION } from '@/seo/pageCopy'
import styles from './AboutPage.module.css'

export function AboutPage() {
  return (
    <section className={styles.page}>
      <Seo
        title="About"
        description={ABOUT_DESCRIPTION}
        canonicalPath={ROUTES.ABOUT}
      />
      <h1>About AB Creations</h1>
      <img
        className={styles.studioPhoto}
        src="/catalog/about.jpg"
        alt="Packing table with kraft boxes and finished acrylic gifts"
      />
      <p>
        AB Creations manufactures custom corporate signage, LED letters, acrylic
        gifts, and made-to-order prints from Gwalior, Madhya Pradesh. Customers
        design and order online — from product discovery through artwork upload,
        approval, production, and delivery.
      </p>
      <p>
        We build reception boards, 3D letters, name plates, glow signs, and
        personalised acrylic pieces under one roof, so offices, retailers, and
        families get the same made-to-order workflow.
      </p>
    </section>
  )
}
