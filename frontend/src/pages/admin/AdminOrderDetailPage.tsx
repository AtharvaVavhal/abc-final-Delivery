import { Link, useParams } from 'react-router-dom'
import { useAdminOrder } from '@/hooks/useAdminOrder'
import { useUpdateAdminOrderStatus } from '@/hooks/useUpdateAdminOrderStatus'
import { OrderStatusForm } from '@/features/admin/OrderStatusForm'
import { PhotoReviewPanel } from '@/features/admin/photo-review/PhotoReviewPanel'
import { OrderStatusBadge } from '@/features/orders/OrderStatusBadge'
import { ORDER_STATUS_LABELS } from '@/features/orders/orderStatus'
import { Alert } from '@/components/ui/Alert'
import { AdminPage } from '@/components/admin/AdminPage'
import { AdminCard } from '@/components/admin/AdminCard'
import { AdminTable } from '@/components/admin/AdminTable'
import { AdminBadge, type AdminBadgeVariant } from '@/components/admin/AdminBadge'
import { AdminEmptyState } from '@/components/admin/AdminEmptyState'
import { AdminPageSkeleton } from '@/components/admin/AdminPageSkeleton'
import { formatPrice } from '@/utils/formatPrice'
import { formatDate } from '@/utils/formatDate'
import { getApiErrorMessage } from '@/utils/apiError'
import { adminProductDetailPath, orderInvoicePath, ROUTES } from '@/constants/routes'
import type { OrderStatus, PaymentAttemptStatus } from '@/types/orders'
import styles from './AdminOrderDetailPage.module.css'

/** Statuses at or past which a customer invoice can be viewed. */
const INVOICEABLE_STATUSES = new Set<OrderStatus>([
  'PAID',
  'CONFIRMED',
  'IN_PRODUCTION',
  'SHIPPED',
  'DELIVERED',
  'REFUNDED',
])

const PAYMENT_ATTEMPT_VARIANT: Record<PaymentAttemptStatus, AdminBadgeVariant> = {
  CAPTURED: 'success',
  FAILED: 'danger',
  INITIATED: 'neutral',
  ABANDONED: 'neutral',
}

/** `amountPaise` is authoritative minor units — this only re-expresses it
 * in major units for display, no financial calculation. */
function displayPaise(amountPaise: string): string {
  return formatPrice((Number(amountPaise) / 100).toFixed(2))
}

/**
 * Behind AdminRoute (App.tsx). GET /admin/orders/:id — the exact same
 * OrderDetailView shape as the customer-facing GET /orders/:id
 * (needsManualRefund included, nothing admin-only on top). The
 * status-change control (OrderStatusForm) submits whatever the admin
 * picks and relies entirely on the backend's 409 to reject an illegal
 * transition. There is no in-app refund action — the only refund
 * affordance is the banner directing the admin to the Razorpay dashboard.
 */
export function AdminOrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: order, isPending, isError, error } = useAdminOrder(id!)
  const updateStatus = useUpdateAdminOrderStatus(id!)

  async function handleStatusSubmit(status: OrderStatus, reason: string) {
    try {
      await updateStatus.mutateAsync(reason ? { status, reason } : { status })
    } catch {
      // Surfaced via updateStatus.error inside OrderStatusForm.
    }
  }

  if (isPending) {
    return <AdminPageSkeleton rows={5} />
  }

  if (isError) {
    return (
      <AdminPage
        title="Order"
        breadcrumbs={[{ label: 'Orders', to: ROUTES.ADMIN_ORDERS }, { label: 'Order' }]}
      >
        <Alert variant="error">{getApiErrorMessage(error)}</Alert>
        <p>
          <Link to={ROUTES.ADMIN_ORDERS} className={styles.backLink}>
            Back to orders
          </Link>
        </p>
      </AdminPage>
    )
  }

  const invoiceable = INVOICEABLE_STATUSES.has(order.status)
  const showTax = Number(order.taxAmount) > 0

  return (
    <AdminPage
      breadcrumbs={[
        { label: 'Orders', to: ROUTES.ADMIN_ORDERS },
        { label: `Order ${order.orderNumber}` },
      ]}
      title={`Order ${order.orderNumber}`}
      description={`Placed ${formatDate(order.createdAt)}`}
      actions={
        <>
          <OrderStatusBadge status={order.status} />
          {invoiceable && (
            <Link to={orderInvoicePath(order.id)} className={styles.headerLink}>
              View invoice
            </Link>
          )}
        </>
      }
    >
      {order.needsManualRefund && (
        <Alert variant="error">
          This order has a refund pending manual processing — action it in the Razorpay dashboard, then
          mark the order Refunded here to close it out.
        </Alert>
      )}

      <PhotoReviewPanel order={order} />

      <AdminCard as="section" flush title="Items">
        {order.items.length === 0 ? (
          <div className={styles.emptyPad}>
            <AdminEmptyState title="No items on this order" />
          </div>
        ) : (
          <AdminTable caption="Order items">
            <AdminTable.Head>
              <AdminTable.Row>
                <AdminTable.HeaderCell>Product</AdminTable.HeaderCell>
                <AdminTable.HeaderCell align="center">Qty</AdminTable.HeaderCell>
                <AdminTable.HeaderCell align="end">Unit price</AdminTable.HeaderCell>
                <AdminTable.HeaderCell align="end">Line total</AdminTable.HeaderCell>
              </AdminTable.Row>
            </AdminTable.Head>
            <AdminTable.Body>
              {order.items.map((item) => (
                <AdminTable.Row key={item.id}>
                  <AdminTable.Cell>
                    <span className={styles.product}>
                      {item.productId ? (
                        <Link
                          to={adminProductDetailPath(item.productId)}
                          className={styles.productLink}
                        >
                          {item.productName}
                        </Link>
                      ) : (
                        <span className={styles.productName}>{item.productName}</span>
                      )}
                      {item.variantLabel && <span className={styles.sub}>{item.variantLabel}</span>}
                      {item.customizations.map((c, i) => (
                        <span key={i} className={styles.sub}>
                          {c.fieldLabel}: {c.textValue ?? 'Uploaded file'}
                        </span>
                      ))}
                    </span>
                  </AdminTable.Cell>
                  <AdminTable.Cell align="center">{item.quantity}</AdminTable.Cell>
                  <AdminTable.Cell align="end">{formatPrice(item.unitPrice)}</AdminTable.Cell>
                  <AdminTable.Cell align="end">{formatPrice(item.lineTotal)}</AdminTable.Cell>
                </AdminTable.Row>
              ))}
            </AdminTable.Body>
          </AdminTable>
        )}
      </AdminCard>

      <AdminCard as="section" title="Order summary">
        <dl className={styles.summary}>
          <div className={styles.summaryRow}>
            <dt>Subtotal</dt>
            <dd>{formatPrice(order.subtotal)}</dd>
          </div>
          <div className={styles.summaryRow}>
            <dt>Shipping</dt>
            <dd>{formatPrice(order.shippingFee)}</dd>
          </div>
          {order.couponCode && (
            <div className={styles.summaryRow}>
              <dt>
                Discount <span className={styles.coupon}>{order.couponCode}</span>
              </dt>
              <dd className={styles.discount}>−{formatPrice(order.discountAmount)}</dd>
            </div>
          )}
          {showTax && (
            <div className={styles.summaryRow}>
              <dt>
                GST{order.taxRatePercent ? ` (${order.taxRatePercent}%)` : ''}
                {order.taxMode === 'INCLUSIVE' ? ' — included' : ''}
              </dt>
              <dd>{formatPrice(order.taxAmount)}</dd>
            </div>
          )}
          <div className={`${styles.summaryRow} ${styles.summaryTotal}`}>
            <dt>Total</dt>
            <dd>{formatPrice(order.total)}</dd>
          </div>
        </dl>
      </AdminCard>

      <AdminCard as="section" title="Update status">
        <OrderStatusForm
          currentStatus={order.status}
          isSubmitting={updateStatus.isPending}
          submitError={updateStatus.isError ? getApiErrorMessage(updateStatus.error) : null}
          onSubmit={(status, reason) => void handleStatusSubmit(status, reason)}
        />
      </AdminCard>

      <AdminCard as="section" title="Shipping">
        <address className={styles.address}>
          <span className={styles.recipient}>{order.shippingRecipientName}</span>
          <span>{order.shippingPhone}</span>
          <span>{order.shippingAddressLine1}</span>
          {order.shippingAddressLine2 && <span>{order.shippingAddressLine2}</span>}
          <span>
            {order.shippingCity}, {order.shippingState} {order.shippingPostalCode}
          </span>
          <span>{order.shippingCountry}</span>
        </address>
        {order.deliveryPin && (
          <p className={styles.deliveryPin}>
            <span className={styles.deliveryPinLabel}>Delivery pin shared by the customer</span>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${order.deliveryPin.latitude},${order.deliveryPin.longitude}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open in Google Maps
            </a>
            <span className={styles.deliveryPinCoords}>
              {order.deliveryPin.latitude.toFixed(5)}, {order.deliveryPin.longitude.toFixed(5)}
            </span>
          </p>
        )}
      </AdminCard>

      <AdminCard as="section" flush title="Status history">
        {order.statusHistory.length === 0 ? (
          <div className={styles.emptyPad}>
            <AdminEmptyState title="No status changes yet" />
          </div>
        ) : (
          <AdminTable caption="Order status history">
            <AdminTable.Head>
              <AdminTable.Row>
                <AdminTable.HeaderCell>Change</AdminTable.HeaderCell>
                <AdminTable.HeaderCell>When</AdminTable.HeaderCell>
                <AdminTable.HeaderCell>Note</AdminTable.HeaderCell>
              </AdminTable.Row>
            </AdminTable.Head>
            <AdminTable.Body>
              {order.statusHistory.map((entry, index) => (
                <AdminTable.Row key={index}>
                  <AdminTable.Cell>
                    <span className={styles.change}>
                      {entry.fromStatus && (
                        <span className={styles.sub}>
                          from {ORDER_STATUS_LABELS[entry.fromStatus]}
                        </span>
                      )}
                      <OrderStatusBadge status={entry.toStatus} />
                    </span>
                  </AdminTable.Cell>
                  <AdminTable.Cell>{formatDate(entry.createdAt)}</AdminTable.Cell>
                  <AdminTable.Cell>{entry.note ?? '—'}</AdminTable.Cell>
                </AdminTable.Row>
              ))}
            </AdminTable.Body>
          </AdminTable>
        )}
      </AdminCard>

      {order.paymentAttempts.length > 0 && (
        <AdminCard as="section" flush title="Payment attempts">
          <AdminTable caption="Payment attempts">
            <AdminTable.Head>
              <AdminTable.Row>
                <AdminTable.HeaderCell>Status</AdminTable.HeaderCell>
                <AdminTable.HeaderCell align="end">Amount</AdminTable.HeaderCell>
                <AdminTable.HeaderCell>Method</AdminTable.HeaderCell>
                <AdminTable.HeaderCell>When</AdminTable.HeaderCell>
                <AdminTable.HeaderCell>Details</AdminTable.HeaderCell>
              </AdminTable.Row>
            </AdminTable.Head>
            <AdminTable.Body>
              {order.paymentAttempts.map((attempt) => (
                <AdminTable.Row key={attempt.id}>
                  <AdminTable.Cell>
                    <AdminBadge variant={PAYMENT_ATTEMPT_VARIANT[attempt.status]}>
                      {attempt.status}
                    </AdminBadge>
                  </AdminTable.Cell>
                  <AdminTable.Cell align="end">{displayPaise(attempt.amountPaise)}</AdminTable.Cell>
                  <AdminTable.Cell>{attempt.method ?? '—'}</AdminTable.Cell>
                  <AdminTable.Cell>{formatDate(attempt.createdAt)}</AdminTable.Cell>
                  <AdminTable.Cell>
                    {attempt.failureReason ?? attempt.failureCode ?? '—'}
                  </AdminTable.Cell>
                </AdminTable.Row>
              ))}
            </AdminTable.Body>
          </AdminTable>
        </AdminCard>
      )}
    </AdminPage>
  )
}
