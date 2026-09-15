import { Link } from 'react-router-dom'
import { ROUTES } from '@/constants/routes'
import { Seo } from '@/seo/Seo'
import styles from './TermsPage.module.css'

// TODO: client to provide final Terms of Service legal copy
export function TermsPage() {
  return (
    <section className={styles.page}>
      <Seo
        title="Terms of Service"
        description="The terms governing use of the PrintForge website and services — orders and payment, customization and intellectual property, production and delivery, cancellations and refunds."
        canonicalPath={ROUTES.TERMS}
        ogType="article"
      />
      <h1>Terms of Service</h1>
      <p className={styles.meta}>
        {/* TODO: client to confirm the effective revision date before launch */}
        Last updated: [date to be confirmed]
      </p>

      <article>
        <h2>1. Acceptance of Terms</h2>
        <p>
          By accessing or using the PrintForge website and services, you agree to
          be bound by these Terms of Service and all applicable laws and
          regulations. If you do not agree, please do not use our services.
        </p>

        <h2>2. Use of Services</h2>
        <ul>
          <li>You must be at least 18 years old to place an order.</li>
          <li>You are responsible for providing accurate information.</li>
          <li>You may not use the service for any unlawful or prohibited purpose.</li>
        </ul>

        <h2>3. Orders and Payment</h2>
        <p>
          All orders are subject to acceptance and availability. Prices are shown
          in INR and include applicable taxes unless otherwise stated. Payment is
          processed securely via our payment partner.
        </p>

        <h2>4. Customization and Intellectual Property</h2>
        <p>
          You retain ownership of the artwork you upload. By submitting artwork,
          you grant PrintForge a non‑exclusive license to reproduce it solely for
          fulfilling your order. You warrant that you have the rights to use the
          uploaded content.
        </p>

        <h2>5. Production and Delivery</h2>
        <p>
          Production timelines are estimates and not guaranteed. Shipping times
          vary by destination. Risk of loss passes to you upon delivery to the
          carrier.
        </p>

        <h2>6. Cancellations and Refunds</h2>
        <p>
          Orders can be cancelled before production begins. Once production has
          started, cancellations are not possible. Refunds are handled per our{' '}
          <Link to={ROUTES.REFUND_POLICY}>Refund Policy</Link>.
        </p>

        <h2>7. Limitation of Liability</h2>
        <p>
          PrintForge is not liable for indirect, incidental, or consequential
          damages arising from the use or inability to use the service, to the
          maximum extent permitted by law.
        </p>

        <h2>8. Governing Law</h2>
        <p>
          These terms are governed by the laws of India. Disputes will be
          resolved in the courts of Mumbai.
        </p>

        <h2>9. Changes to Terms</h2>
        <p>
          We may modify these terms at any time. Continued use of the service
          after changes constitutes acceptance of the new terms.
        </p>

        <h2>10. Contact</h2>
        <p>
          Questions about these terms? Visit our{' '}
          <Link to={ROUTES.CONTACT}>Contact</Link> page.
        </p>
      </article>
    </section>
  )
}
