import { Link } from 'react-router-dom'
import { ROUTES } from '@/constants/routes'
import { Seo } from '@/seo/Seo'
import styles from './RefundPolicyPage.module.css'

// TODO: client to provide final Refund Policy legal copy
export function RefundPolicyPage() {
  return (
    <section className={styles.page}>
      <Seo
        title="Refund Policy"
        description="When AB Creations orders are eligible for a refund, how to request one, refund amounts by order stage, and how defective or incorrect items are handled."
        canonicalPath={ROUTES.REFUND_POLICY}
        ogType="article"
      />
      <h1>Refund Policy</h1>
      <p className={styles.meta}>
        {/* TODO: client to confirm the effective revision date before launch */}
        Last updated: [date to be confirmed]
      </p>

      <article>
        <h2>1. Eligibility</h2>
        <p>
          Refunds are available only for orders that have not entered production.
          Once an order reaches the <strong>In Production</strong> status,
          cancellations and refunds are no longer possible because the items are
          custom‑printed for you.
        </p>

        <h2>2. Requesting a Refund</h2>
        <p>
          To request a refund, contact us via the{' '}
          <Link to={ROUTES.CONTACT}>Contact</Link> page with your order number and
          reason. Requests are reviewed within 2 business days.
        </p>

        <h2>3. Refund Amount</h2>
        <ul>
          <li>Full refund (including shipping) if cancelled before production starts.</li>
          <li>Partial refund (product cost only) if cancelled after production starts but before shipping.</li>
          <li>No refund after the order has been shipped.</li>
        </ul>

        <h2>4. Defective or Incorrect Items</h2>
        <p>
          If you receive a defective or incorrect item, please contact us within
          7 days of delivery with photos. We will arrange a replacement or a full
          refund at our discretion.
        </p>

        <h2>5. Refund Processing</h2>
        <p>
          Approved refunds are issued to the original payment method within
          5‑10 business days, depending on your payment provider.
        </p>

        <h2>6. Non‑Refundable Situations</h2>
        <ul>
          <li>Customised products where the design was approved by the customer.</li>
          <li>Orders cancelled after production has begun.</li>
          <li>Customer‑provided artwork that violates intellectual‑property rights.</li>
        </ul>

        <h2>7. Contact Us</h2>
        <p>
          For any refund‑related questions, please visit our{' '}
          <Link to={ROUTES.CONTACT}>Contact</Link> page.
        </p>
      </article>
    </section>
  )
}
