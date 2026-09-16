import type { CheckoutOrderView } from '@/types/checkout'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
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
          Payment is not done yet, so this order is still waiting. Your cart
          still has these items if you leave and come back. You can also pay
          anytime from “My orders”.
        </p>
      </div>

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
    </div>
  )
}
