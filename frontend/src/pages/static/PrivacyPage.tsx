import { Link } from 'react-router-dom'
import { ROUTES } from '@/constants/routes'
import { Seo } from '@/seo/Seo'
import styles from './PrivacyPage.module.css'

// TODO: client to provide final Privacy Policy legal copy. Section 3 (location and
// delivery pin) and the sign-in-number sentence in section 1 describe what the
// code actually does today; have them reviewed with the rest of the copy.
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
          (processed securely by our payment partner). If you sign in with your
          mobile number, we also save that number as the contact number on your
          account.
        </p>

        <h2>2. How We Use Your Data</h2>
        <ul>
          <li>To fulfill and manage your orders.</li>
          <li>To communicate order status and support requests.</li>
          <li>To improve our products and services.</li>
          <li>To comply with legal obligations.</li>
        </ul>

        <h2>3. Location and Delivery Pin</h2>
        <p>
          We use your device location only if you allow your browser to share
          it, and only for the purposes below.
        </p>
        <ul>
          <li>
            <strong>Finding your PIN code.</strong> To fill in your PIN code,
            city and state, your approximate position is sent to our servers and
            to an OpenStreetMap geocoding service, rounded to within about 11
            metres. We use it once and do not store it. When you drop a delivery
            pin, the pin&apos;s position is sent the same way to suggest your
            street and area; those suggestions are only filled into the form
            for you to check, and are not stored separately.
          </li>
          <li>
            <strong>Delivery pin (optional).</strong> If you choose to drop a
            pin on the map at checkout, we store that point with your order,
            rounded to within about 1 metre, so the courier can find your door.
            It is visible to you, to our staff, and to the courier handling your
            delivery. We erase it once your order is delivered, cancelled or
            refunded. If you do not drop a pin, nothing is stored.
          </li>
        </ul>
        <p>
          You can decline the browser&apos;s location prompt at any time and
          enter your PIN code manually; you can still place your order. The map
          is provided by OpenStreetMap, which receives your IP address when map
          tiles load.
        </p>

        <h2>4. Data Sharing</h2>
        <p>
          We do not sell your personal data. We share data only with trusted
          third‑party processors (payment gateway, shipping carrier, email
          service, map and location services) under strict data‑processing
          agreements.
        </p>

        <h2>5. Data Retention</h2>
        <p>
          We retain personal data only as long as necessary for the purposes
          described above or as required by law.
        </p>

        <h2>6. Your Rights</h2>
        <p>
          You may request access, correction, deletion, or restriction of your
          personal data. Contact us via the{' '}
          <Link to={ROUTES.CONTACT}>Contact</Link> page to exercise these rights.
        </p>

        <h2>7. Security</h2>
        <p>
          We implement appropriate technical and organisational measures to
          protect your data against unauthorized access, alteration, or loss.
        </p>

        <h2>8. Changes to This Policy</h2>
        <p>
          We may update this policy from time to time. The latest version will
          always be posted on this page with an updated revision date.
        </p>

        <h2>9. Contact Us</h2>
        <p>
          If you have questions about this policy, please visit our{' '}
          <Link to={ROUTES.CONTACT}>Contact</Link> page.
        </p>
      </article>
    </section>
  )
}
