import { Link } from 'react-router-dom'
import { ShieldCheck, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Alert'
import { formatPrice } from '@/utils/formatPrice'
import { ROUTES } from '@/constants/routes'
import styles from './CartSummary.module.css'

interface CartSummaryProps {
  subtotal: string
  itemCount: number
  hasUnavailableItems: boolean
}

/** Checkout is blocked while any line is unavailable (§10/§20: an
 * unavailable item is a distinct, visible state — not something the
 * customer can just check out through). Subtotal is server-computed
 * (CartView.subtotal), rendered as-is, never recomputed here. Shipping and
 * tax are deliberately not shown: the cart API doesn't provide them and
 * they're only known once the order is created. */
export function CartSummary({ subtotal, itemCount, hasUnavailableItems }: CartSummaryProps) {
  return (
    <aside className={styles.summary} aria-labelledby="cart-summary-heading">
      <h2 id="cart-summary-heading" className={styles.heading}>
        Summary
      </h2>

      <div className={styles.row}>
        <span>Items</span>
        <span>{itemCount}</span>
      </div>
      <div className={styles.row}>
        <span>Subtotal</span>
        <span className={styles.subtotal}>{formatPrice(subtotal)}</span>
      </div>

      <p className={styles.note}>
        Shipping, discounts, and tax are calculated at checkout.
      </p>

      {hasUnavailableItems && (
        <Alert variant="error">
          Remove the unavailable item(s) above before checking out.
        </Alert>
      )}

      {hasUnavailableItems ? (
        <Button disabled className={styles.checkoutButton}>
          Proceed to checkout
        </Button>
      ) : (
        <Link to={ROUTES.CHECKOUT} className={styles.checkoutLink}>
          <Button className={styles.checkoutButton}>Proceed to checkout</Button>
        </Link>
      )}

      <div className={styles.trustFooter} aria-label="Checkout guarantees">
        <div className={styles.trustItem}>
          <ShieldCheck size={16} className={styles.trustIcon} aria-hidden="true" />
          <span>256-bit SSL encrypted checkout</span>
        </div>
        <div className={styles.trustItem}>
          <CheckCircle2 size={16} className={styles.trustIcon} aria-hidden="true" />
          <span>Free digital proof review</span>
        </div>
      </div>
    </aside>
  )
}
