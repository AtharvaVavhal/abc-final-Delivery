import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useOrder } from '@/hooks/useOrder'
import { orderInvoicePath, ROUTES } from '@/constants/routes'
import { useRetryPayment } from '@/hooks/useRetryPayment'
import { useCancelOrder } from '@/hooks/useCancelOrder'
import { useRazorpayCheckout } from '@/features/checkout/useRazorpayCheckout'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { Page } from '@/components/ui/Page'
import { Skeleton } from '@/components/ui/Skeleton'
import { PriceBreakdown } from '@/features/checkout/PriceBreakdown'
import { Seo } from '@/seo/Seo'
import { formatPrice } from '@/utils/formatPrice'
import { formatDate } from '@/utils/formatDate'
import { getApiErrorMessage } from '@/utils/apiError'
import type { OrderStatus, PaymentAttemptView } from '@/types/orders'
import { ORDER_STATUS_LABELS } from '@/features/orders/orderStatus'
import { OrderStatusBadge } from '@/features/orders/OrderStatusBadge'
import styles from './OrderDetailPage.module.css'

const RETRYABLE_STATUSES = new Set<OrderStatus>(['PENDING_PAYMENT', 'PAYMENT_FAILED'])

/** Mirrors the backend order state machine (order-state-machine.ts): only
 * PAID and CONFIRMED can transition to CANCELLED. */
const CANCELLABLE_STATUSES = new Set<OrderStatus>([
  'PENDING_PAYMENT',
  'PAYMENT_FAILED',
  'PAID',
  'CONFIRMED',
])

/** Mirrors the backend INVOICEABLE_STATUSES gate — an invoice exists only
 * once payment has succeeded (Phase 13.4). */
const INVOICEABLE_STATUSES = new Set<OrderStatus>([
  'PAID',
  'CONFIRMED',
  'IN_PRODUCTION',
  'SHIPPED',
  'DELIVERED',
  'REFUNDED',
])

const PAYMENT_ATTEMPT_LABELS: Record<PaymentAttemptView['status'], string> = {
  INITIATED: 'Payment started',
  CAPTURED: 'Payment received',
  FAILED: 'Payment failed',
  ABANDONED: 'Payment not completed',
}

/**
 * GET /orders/:id — the destination after checkout's Razorpay flow, and
 * also where a "Retry Payment" action (from a payment that failed or was
 * dismissed) lives. This page never trusts POST /payments/verify's
 * response for what to display; it only ever renders `order.status` from
 * its own fetch, which useOrder keeps polling while PENDING_PAYMENT so it
 * catches up once the webhook (the authoritative path, §13.G) lands.
 */
export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: order, isPending, isError, error, refetch } = useOrder(id!)
  const retryPayment = useRetryPayment()
  const cancelOrder = useCancelOrder(id!)
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false)
  // See CheckoutPage.tsx's startPayment for why this must be a ref, not a
  // retryPayment.isPending check — a synchronous double-click's second call
  // lands on the same pre-re-render closure as the first, so an isPending
  // read would still see the stale (false) value.
  const isRetryingRef = useRef(false)

  const { openCheckout, isOpening, isVerifying } = useRazorpayCheckout({
    onVerified: () => {
      void refetch()
    },
    onDismissed: () =>
      setPaymentError('Payment was not completed. Your order is still here — you can retry anytime.'),
    onError: setPaymentError,
  })

  async function handleRetry() {
    if (isRetryingRef.current) return
    if (!order) return
    isRetryingRef.current = true
    setPaymentError(null)
    try {
      const payment = await retryPayment.mutateAsync(order.id)
      await openCheckout(
        payment,
        { orderNumber: order.orderNumber },
        { name: order.shippingRecipientName, contact: order.shippingPhone },
      )
    } catch (err) {
      setPaymentError(getApiErrorMessage(err))
    } finally {
      isRetryingRef.current = false
    }
  }

  if (isPending) {
    return (
      <Page>
        <Seo title="Order" noindex />
        <h1>Order</h1>
        <Skeleton className={styles.skeletonBlock} label="Loading order" />
      </Page>
    )
  }

  if (isError) {
    return (
      <Page>
        <Seo title="Order" noindex />
        <ErrorState
          title="Order"
          message={getApiErrorMessage(error)}
          action={
            <p className={styles.backLink}>
              <Link to={ROUTES.ORDERS}>← All orders</Link>
            </p>
          }
        />
      </Page>
    )
  }

  const canRetryPayment = RETRYABLE_STATUSES.has(order.status)
  const canCancel = CANCELLABLE_STATUSES.has(order.status)
  const latestAttempt = order.paymentAttempts.at(-1)
  const timeline = [...order.statusHistory].reverse()

  return (
    <Page>
      <Seo title={`Order ${order.orderNumber}`} noindex />
      <p className={styles.backLink}>
        <Link to={ROUTES.ORDERS}>← All orders</Link>
      </p>

      <div className={styles.header}>
        <div>
          <h1>Order {order.orderNumber}</h1>
          <p className={styles.placedAt}>Placed {formatDate(order.createdAt)}</p>
        </div>
        <OrderStatusBadge status={order.status} />
      </div>

      {order.status === 'PENDING_PAYMENT' && (
        <Alert variant="info">
          We&rsquo;re confirming your payment — this can take a few moments. This page will update
          automatically.
        </Alert>
      )}

      {canRetryPayment && (
        <div className={styles.retryBlock}>
          {paymentError && <Alert variant="error">{paymentError}</Alert>}
          <Button onClick={() => void handleRetry()} isLoading={retryPayment.isPending || isOpening || isVerifying}>
            {order.status === 'PAYMENT_FAILED' ? 'Retry payment' : 'Pay now'}
          </Button>
        </div>
      )}

      {canCancel && (
        <div className={styles.retryBlock}>
          {cancelOrder.isError && <Alert variant="error">{getApiErrorMessage(cancelOrder.error)}</Alert>}
          {isConfirmingCancel ? (
            <>
              <p>Are you sure you want to cancel this order?</p>
              <Button
                variant="secondary"
                onClick={() => cancelOrder.mutate(undefined, { onSuccess: () => setIsConfirmingCancel(false) })}
                isLoading={cancelOrder.isPending}
              >
                Yes, cancel order
              </Button>
              <Button variant="ghost" onClick={() => setIsConfirmingCancel(false)} disabled={cancelOrder.isPending}>
                Never mind
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={() => setIsConfirmingCancel(true)}>
              Cancel order
            </Button>
          )}
        </div>
      )}

      <div className={styles.layout}>
        <div className={styles.mainCol}>
          <h2 className={styles.heading}>Items</h2>
          <ul className={styles.lines}>
            {order.items.map((item) => (
              <li key={item.id} className={styles.line}>
                <div>
                  <p className={styles.name}>{item.productName}</p>
                  {item.variantLabel && <p className={styles.meta}>{item.variantLabel}</p>}
                  <p className={styles.meta}>
                    {formatPrice(item.unitPrice)} × {item.quantity}
                  </p>
                  {item.customizations.length > 0 && (
                    <ul className={styles.customizations}>
                      {item.customizations.map((c, ci) => (
                        <li key={ci}>
                          {c.fieldLabel}: {c.textValue ?? (c.uploadedFileId ? 'file uploaded' : '—')}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <span className={styles.lineTotal}>{formatPrice(item.lineTotal)}</span>
              </li>
            ))}
          </ul>

          {timeline.length > 0 && (
            <>
              <h2 className={styles.heading}>Order timeline</h2>
              <ol className={styles.timeline}>
                {timeline.map((entry, i) => (
                  <li key={i} className={styles.timelineItem}>
                    <span className={styles.timelineStatus}>
                      {ORDER_STATUS_LABELS[entry.toStatus]}
                    </span>
                    <span className={styles.timelineDate}>{formatDate(entry.createdAt)}</span>
                    {entry.note && <span className={styles.timelineNote}>{entry.note}</span>}
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>

        <div className={styles.sidebar}>
          <div className={styles.summaryBlock}>
            <h2 className={styles.heading}>Payment summary</h2>
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
            {latestAttempt && (
              <p className={styles.paymentStatus}>
                {PAYMENT_ATTEMPT_LABELS[latestAttempt.status]}
                {latestAttempt.method ? ` · ${latestAttempt.method}` : ''}
                {latestAttempt.capturedAt ? ` · ${formatDate(latestAttempt.capturedAt)}` : ''}
              </p>
            )}
            {order.needsManualRefund && (
              <p className={styles.paymentStatus}>A refund for this order is being processed.</p>
            )}
          </div>

          {INVOICEABLE_STATUSES.has(order.status) && (
            <p className={styles.invoiceLink}>
              <Link to={orderInvoicePath(order.id)}>View / print invoice</Link>
            </p>
          )}

          <div className={styles.summaryBlock}>
            <h2 className={styles.heading}>Shipping to</h2>
            <p className={styles.address}>
              {order.shippingRecipientName}
              <br />
              {order.shippingAddressLine1}
              {order.shippingAddressLine2 && (
                <>
                  <br />
                  {order.shippingAddressLine2}
                </>
              )}
              <br />
              {order.shippingCity}, {order.shippingState} {order.shippingPostalCode}
              <br />
              {order.shippingCountry}
            </p>
          </div>
        </div>
      </div>
    </Page>
  )
}
