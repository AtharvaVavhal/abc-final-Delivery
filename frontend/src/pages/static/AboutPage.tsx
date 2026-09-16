import { Seo } from '@/seo/Seo'
import { ROUTES } from '@/constants/routes'
import styles from './AboutPage.module.css'

// TODO: client to provide final About page copy
export function AboutPage() {
  return (
    <section className={styles.page}>
      <Seo
        title="About"
        description="AB Creations is a custom-printing store for designing and ordering printed products entirely online — from product discovery through file upload, checkout, production and delivery."
        canonicalPath={ROUTES.ABOUT}
      />
      <h1>About AB Creations</h1>
      <img
        className={styles.studioPhoto}
        src="/catalog/about.jpg"
        alt="Packing table with kraft boxes and finished acrylic gifts"
      />
      <p>
        AB Creations is a custom‑printing store that lets customers design and order
        printed products entirely online. From product discovery through file upload,
        checkout, production and delivery — every step is handled in a single,
        transparent workflow.
      </p>
      <p>
        Our mission is to make professional‑grade custom printing accessible to
        individuals and small businesses without the friction of traditional
        print‑shop workflows.
      </p>
    </section>
  )
}
