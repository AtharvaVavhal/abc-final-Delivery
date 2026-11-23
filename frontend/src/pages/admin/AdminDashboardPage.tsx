import { useId } from 'react'
import { Link } from 'react-router-dom'
import { useAdminDashboard } from '@/hooks/useAdminDashboard'
import { getApiErrorMessage } from '@/utils/apiError'
import { Alert } from '@/components/ui/Alert'
import { AdminPage } from '@/components/admin/AdminPage'
import { AdminCard } from '@/components/admin/AdminCard'
import { AdminTable } from '@/components/admin/AdminTable'
import { AdminBadge } from '@/components/admin/AdminBadge'
import { AdminEmptyState } from '@/components/admin/AdminEmptyState'
import { AdminPageSkeleton } from '@/components/admin/AdminPageSkeleton'
import { SalesOverview } from '@/features/admin/overview/SalesOverview'
import { OrderStatusBadge } from '@/features/orders/OrderStatusBadge'
import { formatPrice } from '@/utils/formatPrice'
import { formatDate } from '@/utils/formatDate'
import type { OrderStatus } from '@/types/orders'
import { ORDER_STATUS_LABELS } from '@/features/orders/orderStatus'
import { adminOrderDetailPath, ROUTES } from '@/constants/routes'
import styles from './AdminDashboardPage.module.css'

const ATTENTION_STAGES: { status: OrderStatus; action: string }[] = [
  { status: 'PAID', action: 'Confirm paid orders' },
  { status: 'CONFIRMED', action: 'Start production' },
  { status: 'PAYMENT_FAILED', action: 'Review failed payments' },
]
const OPEN_STAGES: OrderStatus[] = ['PENDING_PAYMENT', 'PAID', 'CONFIRMED', 'IN_PRODUCTION', 'SHIPPED']
const ordersFor = (status: OrderStatus) => `${ROUTES.ADMIN_ORDERS}?status=${status}`

/** A compact headline figure. Still a named region with an h2, so it reads
 * the same to assistive tech as the card it replaces. */
function StatTile({ title, value }: { title: string; value: string | number }) {
  const headingId = useId()
  return (
    <section className={styles.statTile} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.statLabel}>
        {title}
      </h2>
      <p className={styles.statValue}>{value}</p>
    </section>
  )
}

/**
 * Behind AdminRoute (App.tsx). Minimal by design — GET /admin/dashboard is
 * framed by the backend as "minimal — no charts" (§19): all-time order
 * count, per-status breakdown, paid-or-later revenue, and the ten most
 * recent orders. This page is a faithful thin view of exactly those four
 * fields — no client-side calculation, no time-series, no extra fetches.
 */
export function AdminDashboardPage() {
  const { data, isPending, isError, error } = useAdminDashboard()
  const countFor = (status: OrderStatus) => data?.ordersByStatus.find(row => row.status === status)?.count ?? 0
  const openOrders = OPEN_STAGES.reduce((sum, status) => sum + countFor(status), 0)

  if (isPending) {
    return <AdminPageSkeleton rows={4} />
  }

  const viewAllOrders = (
    <Link to={ROUTES.ADMIN_ORDERS} className={styles.link}>
      View all orders
    </Link>
  )

  return (
    <AdminPage
      title="Overview"
      description="Sales trends, what needs attention, and the ten most recent orders."
    >
      {isError ? (
        <Alert variant="error">{getApiErrorMessage(error)}</Alert>
      ) : data ? (
        <>
          <div className={styles.statGrid}>
            <StatTile title="Total orders" value={data.totalOrders} />
            <StatTile title="Revenue (paid or later)" value={formatPrice(data.totalRevenue)} />
          </div>

          <SalesOverview />

          <AdminCard as="section" title="Needs attention">
            <div className={styles.attentionGrid}>
              {ATTENTION_STAGES.map(({ status, action }) => (
                <Link key={status} to={ordersFor(status)} className={styles.attentionTile}>
                  <span className={styles.attentionLabel}>{action}</span>
                  <strong className={styles.attentionCount}>{countFor(status)}</strong>
                  <span className={styles.attentionHint}>View orders</span>
                </Link>
              ))}
            </div>
          </AdminCard>

          <AdminCard as="section" title="Open orders by stage">
            <p className={styles.stageIntro}>Awaiting payment through shipment; delivered, cancelled, refunded and failed-payment orders are excluded.</p>
            {openOrders === 0 && <p className={styles.stageEmpty}>No open orders.</p>}
            <ul className={styles.stageList}>
              {OPEN_STAGES.map(status => (
                <li key={status}>
                  <Link className={styles.stageLink} to={ordersFor(status)}>
                    <span>{ORDER_STATUS_LABELS[status]}</span>
                    <span className={styles.stageBar} aria-hidden="true"><span style={{ width: `${openOrders ? countFor(status) / openOrders * 100 : 0}%` }} /></span>
                    <strong>{countFor(status)}</strong>
                  </Link>
                </li>
              ))}
            </ul>
          </AdminCard>

          <AdminCard as="section" title="Orders by status">
            <dl className={styles.statusGrid}>
              {data.ordersByStatus.map((row) => (
                <div key={row.status} className={styles.statusItem}>
                  <dt className={styles.statusTerm}>
                    <OrderStatusBadge status={row.status} />
                  </dt>
                  <dd className={styles.statusCount}>{row.count}</dd>
                </div>
              ))}
            </dl>
          </AdminCard>

          {data.recentOrders.length === 0 ? (
            <AdminCard as="section" title="Recent orders" actions={viewAllOrders}>
              <AdminEmptyState
                title="No orders yet"
                description="Recent orders will appear here as customers place them."
              />
            </AdminCard>
          ) : (
            <AdminCard as="section" flush title="Recent orders" actions={viewAllOrders}>
              <AdminTable caption="Recent orders">
                <AdminTable.Head>
                  <AdminTable.Row>
                    <AdminTable.HeaderCell>Order</AdminTable.HeaderCell>
                    <AdminTable.HeaderCell className={styles.hideMobile}>Date</AdminTable.HeaderCell>
                    <AdminTable.HeaderCell align="center" className={styles.hideMobile}>Items</AdminTable.HeaderCell>
                    <AdminTable.HeaderCell>Status</AdminTable.HeaderCell>
                    <AdminTable.HeaderCell align="end">Total</AdminTable.HeaderCell>
                  </AdminTable.Row>
                </AdminTable.Head>
                <AdminTable.Body>
                  {data.recentOrders.map((order) => (
                    <AdminTable.Row key={order.id}>
                      <AdminTable.Cell>
                        <Link to={adminOrderDetailPath(order.id)} className={styles.orderLink}>
                          {order.orderNumber}
                        </Link>
                      </AdminTable.Cell>
                      <AdminTable.Cell className={styles.hideMobile}><span className={styles.nowrap}>{formatDate(order.createdAt)}</span></AdminTable.Cell>
                      <AdminTable.Cell align="center" className={styles.hideMobile}>{order.itemCount}</AdminTable.Cell>
                      <AdminTable.Cell>
                        <span className={styles.statusCell}>
                          <OrderStatusBadge status={order.status} />
                          {order.needsManualRefund && (
                            <AdminBadge variant="warning">Refund pending</AdminBadge>
                          )}
                        </span>
                      </AdminTable.Cell>
                      <AdminTable.Cell align="end">{formatPrice(order.total)}</AdminTable.Cell>
                    </AdminTable.Row>
                  ))}
                </AdminTable.Body>
              </AdminTable>
            </AdminCard>
          )}
        </>
      ) : null}
    </AdminPage>
  )
}
