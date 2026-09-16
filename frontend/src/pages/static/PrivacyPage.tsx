import { Link } from 'react-router-dom'
import { ROUTES } from '@/constants/routes'
import { Seo } from '@/seo/Seo'
import styles from './PrivacyPage.module.css'

// TODO: client to provide final Privacy Policy legal copy
export function PrivacyPage() {
  return (
    <section className={styles.page}>
      <Seo
        title="Privacy Policy"
        description="How AB Creations collects, uses, shares, retains and protects your personal data, and the rights you have over it."
        canonicalPath={ROUTES.PRIVACY}
        ogType="article"
      />
      <h1>Privacy Policy</h1>
      <p className={styles.meta}>
        {/* TODO: client to confirm the effective revision date before launch */}
        Last updated: [date to be confirmed]
      </p>

      <article>
        <h2>1. Information We Collect</h2>
        <p>
          We collect personal data you voluntarily provide when you create an
          account, place an order, or contact us. This may include your name,
          email address, shipping address, phone number, and payment details
          (processed securely by our payment partner).
        </p>

        <h2>2. How We Use Your Data</h2>
        <ul>
          <li>To fulfill and manage your orders.</li>
          <li>To communicate order status and support requests.</li>
          <li>To improve our products and services.</li>
          <li>To comply with legal obligations.</li>
        </ul>

        <h2>3. Data Sharing</h2>
        <p>
          We do not sell your personal data. We share data only with trusted
          third‑party processors (payment gateway, shipping carrier, email
          service) under strict data‑processing agreements.
        </p>

        <h2>4. Data Retention</h2>
        <p>
          We retain personal data only as long as necessary for the purposes
          described above or as required by law.
        </p>

        <h2>5. Your Rights</h2>
        <p>
          You may request access, correction, deletion, or restriction of your
          personal data. Contact us via the{' '}
          <Link to={ROUTES.CONTACT}>Contact</Link> page to exercise these rights.
        </p>

        <h2>6. Security</h2>
        <p>
          We implement appropriate technical and organisational measures to
          protect your data against unauthorized access, alteration, or loss.
        </p>

        <h2>7. Changes to This Policy</h2>
        <p>
          We may update this policy from time to time. The latest version will
          always be posted on this page with an updated revision date.
        </p>

        <h2>8. Contact Us</h2>
        <p>
          If you have questions about this policy, please visit our{' '}
          <Link to={ROUTES.CONTACT}>Contact</Link> page.
        </p>
      </article>
    </section>
  )
}
