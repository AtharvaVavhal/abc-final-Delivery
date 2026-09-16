import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import type { OrderListItemView, OrderStatus } from '@/types/orders'
import { orderDetailPath } from '@/constants/routes'
import { formatPrice } from '@/utils/formatPrice'
import { formatDate } from '@/utils/formatDate'
import { useCancelOrder } from '@/hooks/useCancelOrder'
import { Button } from '@/components/ui/Button'
import { getApiErrorMessage } from '@/utils/apiError'
import { OrderStatusBadge } from './OrderStatusBadge'
import styles from './OrderListRow.module.css'

interface OrderListRowProps {
  order: OrderListItemView
}

const LIST_CANCELLABLE = new Set<OrderStatus>(['PENDING_PAYMENT', 'PAYMENT_FAILED'])

/** Links into the existing OrderDetailPage (/orders/:id) — that page owns
 * payment-retry and polling. Unpaid rows also expose Cancel order here so
 * a dismissed Razorpay attempt can be dropped without opening checkout. */
export function OrderListRow({ order }: OrderListRowProps) {
  const canCancel = LIST_CANCELLABLE.has(order.status)
  const cancelOrder = useCancelOrder(order.id)
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false)

  return (
    <article className={styles.row}>
      <Link to={orderDetailPath(order.id)} className={styles.mainLink}>
        <div className={styles.primary}>
          <span className={styles.orderNumber}>{order.orderNumber}</span>
          <span className={styles.date}>{formatDate(order.createdAt)}</span>
        </div>
        <OrderStatusBadge status={order.status} />
        <span className={styles.itemCount}>
          {order.itemCount} {order.itemCount === 1 ? 'item' : 'items'}
        </span>
        <span className={styles.total}>{formatPrice(order.total)}</span>
        <ChevronRight size={18} aria-hidden="true" className={styles.chevron} />
      </Link>
      {canCancel && (
        <div className={styles.cancel}>
          {cancelOrder.isError && (
            <p className={styles.cancelError}>{getApiErrorMessage(cancelOrder.error)}</p>
          )}
          {isConfirmingCancel ? (
            <>
              <Button
                variant="secondary"
                onClick={() =>
                  cancelOrder.mutate(undefined, { onSuccess: () => setIsConfirmingCancel(false) })
                }
                isLoading={cancelOrder.isPending}
              >
                Yes, cancel order
              </Button>
              <Button
                variant="ghost"
                onClick={() => setIsConfirmingCancel(false)}
                disabled={cancelOrder.isPending}
              >
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
    </article>
  )
}
