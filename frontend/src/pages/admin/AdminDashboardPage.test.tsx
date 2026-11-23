import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import MockAdapter from 'axios-mock-adapter'
import { apiClient } from '@/services/api/client'
import { renderWithProviders } from '@/test/test-utils'
import { formatDate } from '@/utils/formatDate'
import { AdminDashboardPage } from './AdminDashboardPage'

function buildOrder(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'order-1',
    orderNumber: 'PF-000014',
    status: 'PENDING_PAYMENT',
    total: '199.00',
    currency: 'INR',
    itemCount: 1,
    needsManualRefund: false,
    createdAt: '2026-08-27T14:27:57.215Z',
    ...overrides,
  }
}

function buildDashboard(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    totalOrders: 14,
    ordersByStatus: [
      { status: 'PENDING_PAYMENT', count: 11 },
      { status: 'PAID', count: 3 },
      { status: 'PAYMENT_FAILED', count: 0 },
      { status: 'CONFIRMED', count: 0 },
      { status: 'IN_PRODUCTION', count: 0 },
      { status: 'SHIPPED', count: 0 },
      { status: 'DELIVERED', count: 0 },
      { status: 'CANCELLED', count: 0 },
      { status: 'REFUNDED', count: 0 },
    ],
    totalRevenue: '597.00',
    recentOrders: [buildOrder()],
    ...overrides,
  }
}

function reply(mock: MockAdapter, data: unknown) {
  mock.onGet('/admin/dashboard').reply(200, { success: true, data })
}

const STATUS_LABELS = [
  'Awaiting payment',
  'Payment confirmed',
  'Payment failed',
  'Confirmed',
  'In production',
  'Shipped',
  'Delivered',
  'Cancelled',
  'Refunded',
]

describe('AdminDashboardPage', () => {
  let mock: MockAdapter

  beforeEach(() => {
    mock = new MockAdapter(apiClient)
  })

  afterEach(() => {
    mock.restore()
  })

  // Preserved from the original suite.
  it('renders order count, revenue, per-status breakdown, and recent orders — not a JSON dump', async () => {
    reply(mock, buildDashboard())
    renderWithProviders(<AdminDashboardPage />)

    expect(await screen.findByText('14')).toBeInTheDocument()
    expect(screen.getByText('₹597.00')).toBeInTheDocument()
    expect(screen.getAllByText('Awaiting payment').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: /PF-000014/ })).toBeInTheDocument()
    expect(screen.queryByText(/^\{/)).not.toBeInTheDocument()
  })

  // Preserved from the original suite.
  it('links a recent order into the admin order detail route', async () => {
    reply(mock, buildDashboard())
    renderWithProviders(<AdminDashboardPage />)

    const link = await screen.findByRole('link', { name: /PF-000014/ })
    expect(link).toHaveAttribute('href', '/admin/orders/order-1')
  })

  it('renders exactly one h1 titled "Overview" with a factual description', async () => {
    reply(mock, buildDashboard())
    renderWithProviders(<AdminDashboardPage />)

    await screen.findByText('14')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Overview')
    expect(
      screen.getByText('Sales trends, what needs attention, and the ten most recent orders.'),
    ).toBeInTheDocument()
  })

  it('renders the two stat tiles with backend values and a clear revenue label', async () => {
    reply(mock, buildDashboard({ totalOrders: 42, totalRevenue: '1234.50' }))
    renderWithProviders(<AdminDashboardPage />)

    await screen.findByText('42')
    const totalOrders = screen.getByRole('region', { name: 'Total orders' })
    expect(within(totalOrders).getByText('42')).toBeInTheDocument()

    const revenue = screen.getByRole('region', { name: 'Revenue (paid or later)' })
    expect(within(revenue).getByText('₹1,234.50')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: 'Revenue (paid or later)' }),
    ).toBeInTheDocument()
  })

  it('renders all 9 order statuses, including zero-count ones, each with its count', async () => {
    reply(mock, buildDashboard())
    renderWithProviders(<AdminDashboardPage />)

    await screen.findByText('14')
    const statusRegion = screen.getByRole('region', { name: 'Orders by status' })

    for (const label of STATUS_LABELS) {
      expect(within(statusRegion).getByText(label)).toBeInTheDocument()
    }
    expect(within(statusRegion).getByText('11')).toBeInTheDocument()
    expect(within(statusRegion).getByText('3')).toBeInTheDocument()
    // 7 statuses are zero-filled and still render.
    expect(within(statusRegion).getAllByText('0')).toHaveLength(7)
    // Semantic term/definition pairing.
    expect(statusRegion.querySelectorAll('dl dt')).toHaveLength(9)
    expect(statusRegion.querySelectorAll('dl dd')).toHaveLength(9)
  })

  it('renders recent orders as a semantic table with the Step 3A columns', async () => {
    reply(mock, buildDashboard())
    renderWithProviders(<AdminDashboardPage />)

    const table = await screen.findByRole('table')
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Order', 'Date', 'Items', 'Status', 'Total'])
  })

  it('renders each recent order row: link, formatted date, item count, status badge, formatted total', async () => {
    reply(
      mock,
      buildDashboard({
        recentOrders: [buildOrder({ itemCount: 3, total: '450.00', createdAt: '2026-03-05T00:00:00.000Z' })],
      }),
    )
    renderWithProviders(<AdminDashboardPage />)

    const row = (await screen.findByRole('link', { name: /PF-000014/ })).closest('tr') as HTMLElement
    expect(within(row).getByRole('link', { name: 'PF-000014' })).toHaveAttribute(
      'href',
      '/admin/orders/order-1',
    )
    expect(within(row).getByText(formatDate('2026-03-05T00:00:00.000Z'))).toBeInTheDocument()
    expect(within(row).getByText('3')).toBeInTheDocument()
    expect(within(row).getByText('Awaiting payment')).toBeInTheDocument()
    expect(within(row).getByText('₹450.00')).toBeInTheDocument()
    // Order number is the row's only link.
    expect(within(row).getAllByRole('link')).toHaveLength(1)
  })

  it('shows the manual-refund indicator only when needsManualRefund is true', async () => {
    reply(mock, buildDashboard({ recentOrders: [buildOrder({ needsManualRefund: true })] }))
    renderWithProviders(<AdminDashboardPage />)

    const row = (await screen.findByRole('link', { name: /PF-000014/ })).closest('tr') as HTMLElement
    expect(within(row).getByText('Refund pending')).toBeInTheDocument()
  })

  it('links "View all orders" to the orders list', async () => {
    reply(mock, buildDashboard())
    renderWithProviders(<AdminDashboardPage />)

    await screen.findByText('14')
    expect(screen.getByRole('link', { name: 'View all orders' })).toHaveAttribute(
      'href',
      '/admin/orders',
    )
  })

  it('shows an empty state (not a table) when there are no recent orders', async () => {
    reply(mock, buildDashboard({ recentOrders: [] }))
    renderWithProviders(<AdminDashboardPage />)

    expect(await screen.findByText('No orders yet')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    // The navigation affordance is still there.
    expect(screen.getByRole('link', { name: 'View all orders' })).toBeInTheDocument()
  })

  it('shows a page-level skeleton (polite loading status) while the dashboard is loading', () => {
    mock.onGet('/admin/dashboard').reply(() => new Promise(() => {}))
    renderWithProviders(<AdminDashboardPage />)

    expect(screen.getByText('Loading').closest('[role="status"]')).toBeInTheDocument()
    expect(screen.queryByText('Total orders')).not.toBeInTheDocument()
  })

  it('surfaces a query error through the shared Alert', async () => {
    mock.onGet('/admin/dashboard').reply(500, {
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Dashboard is down', details: [] },
    })
    renderWithProviders(<AdminDashboardPage />)

    expect(await screen.findByText('Dashboard is down')).toBeInTheDocument()
  })

  it('has no search box or canvas chart, and no metrics the backend does not provide', async () => {
    reply(mock, buildDashboard())
    renderWithProviders(<AdminDashboardPage />)

    await screen.findByText('14')
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(document.querySelector('canvas')).toBeNull()
    expect(
      screen.queryByText(/conversion|top product|top customer|low stock/i),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  })

  it('keeps the rest of the page working when the sales trends are unavailable', async () => {
    reply(mock, buildDashboard())
    mock.onGet('/admin/dashboard/overview').reply(500, {
      success: false,
      error: { code: 'INTERNAL', message: 'boom', details: [] },
    })
    renderWithProviders(<AdminDashboardPage />)

    expect(await screen.findByText('14')).toBeInTheDocument()
    expect(await screen.findByText('Sales trends are unavailable right now.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /PF-000014/ })).toBeInTheDocument()
  })
})
