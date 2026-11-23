import { Link, useSearchParams } from 'react-router-dom'
import { useAdminOrders } from '@/hooks/useAdminOrders'
import { getApiErrorMessage } from '@/utils/apiError'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'
import { AdminPage } from '@/components/admin/AdminPage'
import { AdminCard } from '@/components/admin/AdminCard'
import { AdminTable } from '@/components/admin/AdminTable'
import { AdminSelect } from '@/components/admin/AdminSelect'
import { AdminBadge } from '@/components/admin/AdminBadge'
import { AdminEmptyState } from '@/components/admin/AdminEmptyState'
import { AdminPagination } from '@/components/admin/AdminPagination'
import { AdminPageSkeleton } from '@/components/admin/AdminPageSkeleton'
import { OrderStatusBadge } from '@/features/orders/OrderStatusBadge'
import { ORDER_STATUS_LABELS } from '@/features/orders/orderStatus'
import { adminOrderDetailPath } from '@/constants/routes'
import { formatPrice } from '@/utils/formatPrice'
import { formatDate } from '@/utils/formatDate'
import type { OrderStatus } from '@/types/orders'
import styles from './AdminOrdersPage.module.css'

const DEFAULT_LIMIT = 20

const ORDER_STATUS_VALUES = Object.keys(ORDER_STATUS_LABELS) as OrderStatus[]

/** Quick views over the same `?status=` filter the Status select drives —
 * the stages an order moves through in day-to-day work. */
const STATUS_TABS: { label: string; value: OrderStatus | '' }[] = [
  { label: 'All orders', value: '' },
  { label: 'Awaiting payment', value: 'PENDING_PAYMENT' },
  { label: 'Payment confirmed', value: 'PAID' },
  { label: 'In production', value: 'IN_PRODUCTION' },
  { label: 'Shipped', value: 'SHIPPED' },
  { label: 'Delivered', value: 'DELIVERED' },
]
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parseStatus(value: string | null): OrderStatus | undefined {
  return value && (ORDER_STATUS_VALUES as string[]).includes(value) ? (value as OrderStatus) : undefined
}

/** Behind AdminRoute (App.tsx). GET /admin/orders is paginated the same
 * way GET /orders is (confirmed live) — real page/limit params, no
 * client-side slicing. Unscoped by customer (unlike /orders, this is
 * every order in the system), newest-first. The backend also accepts
 * status/userId/dateFrom/dateTo filters (ListAdminOrdersQueryDto) — no
 * free-text search or sort param exists server-side. Filter + page state
 * lives entirely in the URL query, same pattern as AdminProductsPage. */
export function AdminOrdersPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const page = Number(searchParams.get('page') ?? '1')
  const status = parseStatus(searchParams.get('status'))
  const dateFrom = searchParams.get('dateFrom') ?? ''
  const dateTo = searchParams.get('dateTo') ?? ''
  const userId = searchParams.get('userId') ?? ''

  // The backend rejects a non-UUID userId with a 400 — validate client-side
  // so a typo shows as an inline field error instead of a page-level Alert.
  const userIdError = userId !== '' && !UUID_RE.test(userId) ? 'Enter a full customer UUID' : undefined
  const hasActiveFilters = Boolean(status || dateFrom || dateTo || userId)

  const ordersQuery = useAdminOrders({
    page,
    limit: DEFAULT_LIMIT,
    status,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    userId: userId && !userIdError ? userId : undefined,
  })

  function setFilter(key: 'status' | 'dateFrom' | 'dateTo' | 'userId', value: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (value) {
        next.set(key, value)
      } else {
        next.delete(key)
      }
      // Changing a filter can shrink the result set — go back to page 1 so
      // we never land on a now-out-of-range page.
      next.set('page', '1')
      return next
    })
  }

  function clearFilters() {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      for (const key of ['status', 'dateFrom', 'dateTo', 'userId']) {
        next.delete(key)
      }
      next.set('page', '1')
      return next
    })
  }

  function goToPage(nextPage: number) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('page', String(nextPage))
      return next
    })
  }

  if (ordersQuery.isPending) {
    return <AdminPageSkeleton rows={4} />
  }

  const data = ordersQuery.data

  return (
    <AdminPage title="Orders" description="Every order in the system, newest first.">
      <nav className={styles.tabs} aria-label="Order views">
        {STATUS_TABS.map((tab) => {
          const active = (status ?? '') === tab.value
          return (
            <button
              key={tab.label}
              type="button"
              className={active ? `${styles.tab} ${styles.tabActive}` : styles.tab}
              aria-pressed={active}
              onClick={() => setFilter('status', tab.value)}
            >
              {tab.label}
            </button>
          )
        })}
      </nav>

      <AdminCard as="section" title="Filters">
        <div className={styles.filters}>
          <AdminSelect
            label="Status"
            name="status"
            value={status ?? ''}
            onChange={(event) => setFilter('status', event.target.value)}
          >
            <option value="">All statuses</option>
            {ORDER_STATUS_VALUES.map((value) => (
              <option key={value} value={value}>
                {ORDER_STATUS_LABELS[value]}
              </option>
            ))}
          </AdminSelect>

          <TextField
            type="date"
            label="From"
            name="dateFrom"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(event) => setFilter('dateFrom', event.target.value)}
          />

          <TextField
            type="date"
            label="To"
            name="dateTo"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(event) => setFilter('dateTo', event.target.value)}
          />

          <TextField
            label="Customer ID"
            name="userId"
            placeholder="Customer UUID"
            value={userId}
            error={userIdError}
            onChange={(event) => setFilter('userId', event.target.value.trim())}
          />

          {hasActiveFilters && (
            <Button variant="secondary" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </div>
      </AdminCard>

      {ordersQuery.isError ? (
        <Alert variant="error">{getApiErrorMessage(ordersQuery.error)}</Alert>
      ) : data && data.items.length === 0 ? (
        <AdminEmptyState
          title={hasActiveFilters ? 'No orders match these filters' : 'No orders yet'}
          description={
            hasActiveFilters
              ? 'Try widening the date range or clearing the status filter.'
              : 'Orders placed by customers will appear here.'
          }
          action={
            hasActiveFilters ? (
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : data ? (
        <div className={styles.results} aria-busy={ordersQuery.isFetching || undefined}>
          <AdminCard flush>
            <AdminTable caption="Orders">
              <AdminTable.Head>
                <AdminTable.Row>
                  <AdminTable.HeaderCell>Order</AdminTable.HeaderCell>
                  <AdminTable.HeaderCell>Date</AdminTable.HeaderCell>
                  <AdminTable.HeaderCell align="center">Items</AdminTable.HeaderCell>
                  <AdminTable.HeaderCell>Status</AdminTable.HeaderCell>
                  <AdminTable.HeaderCell align="end">Total</AdminTable.HeaderCell>
                </AdminTable.Row>
              </AdminTable.Head>
              <AdminTable.Body>
                {data.items.map((order) => (
                  <AdminTable.Row key={order.id}>
                    <AdminTable.Cell>
                      <Link to={adminOrderDetailPath(order.id)} className={styles.orderLink}>
                        {order.orderNumber}
                      </Link>
                    </AdminTable.Cell>
                    <AdminTable.Cell>{formatDate(order.createdAt)}</AdminTable.Cell>
                    <AdminTable.Cell align="center">{order.itemCount}</AdminTable.Cell>
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

          <AdminPagination
            page={data.meta.page}
            totalPages={data.meta.totalPages}
            onPageChange={goToPage}
            label="Orders pagination"
          />
        </div>
      ) : null}
    </AdminPage>
  )
}
