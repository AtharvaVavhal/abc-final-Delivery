import type { CheckoutOrderView } from '@/types/checkout'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Link } from 'react-router-dom'
import { ROUTES } from '@/constants/routes'
import { formatPrice } from '@/utils/formatPrice'
import { PriceBreakdown } from './PriceBreakdown'
import styles from './OrderPendingPayment.module.css'

interface OrderPendingPaymentProps {
  order: CheckoutOrderView
  error: string | null
  onRetry: () => void
  isProcessing: boolean
  isScriptLoading?: boolean
}

/**
 * Shown once POST /checkout/orders has created the order — the shipping
 * form is gone for good at this point (the address is already snapshotted
 * onto the order), and this view persists across a dismissed/failed
 * payment attempt so the order never appears to have vanished (§13.G). The
 * "Retry Payment" action re-opens Razorpay Checkout.js via
 * POST /checkout/orders/:id/retry-payment rather than re-submitting a new
 * checkout — the same order, reusing its Razorpay order id.
 */
export function OrderPendingPayment({ order, error, onRetry, isProcessing, isScriptLoading }: OrderPendingPaymentProps) {
  const isDisabled = isProcessing || isScriptLoading

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <p className={styles.eyebrow}>Order placed · awaiting payment</p>
        <h2 className={styles.heading}>Order {order.orderNumber}</h2>
        <p className={styles.subheading}>
          Payment is not done yet, so this order is still waiting. Pay below,
          or change your cart first — checkout will then use the new items
          instead of this order.
        </p>
      </div>

      {order.items.length > 0 && (
        <ul className={styles.items}>
          {order.items.map((item) => (
            <li key={item.id}>
              {item.productName}
              {item.variantLabel ? ` · ${item.variantLabel}` : ''} × {item.quantity}
              <span>{formatPrice(item.lineTotal)}</span>
            </li>
          ))}
        </ul>
      )}

      <PriceBreakdown
        subtotal={order.subtotal}
        shippingFee={order.shippingFee}
        discountAmount={order.discountAmount}
        couponCode={order.couponCode}
        taxAmount={order.taxAmount}
        taxMode={order.taxMode}
        taxRatePercent={order.taxRatePercent}
        total={order.total}
      />

      {error && <Alert variant="error">{error}</Alert>}

      <Button
        onClick={onRetry}
        isLoading={isDisabled}
        className={styles.payButton}
        disabled={isDisabled}
      >
        {isScriptLoading ? 'Loading payment…' : error ? 'Retry payment' : 'Pay now'}
      </Button>
      <p className={styles.cartLink}>
        <Link to={ROUTES.CART}>Change items in cart</Link>
      </p>
    </div>
  )
}
