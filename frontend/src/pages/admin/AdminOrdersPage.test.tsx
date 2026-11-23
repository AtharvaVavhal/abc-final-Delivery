import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MockAdapter from 'axios-mock-adapter'
import { apiClient } from '@/services/api/client'
import { renderWithProviders } from '@/test/test-utils'
import { AdminOrdersPage } from './AdminOrdersPage'

function ordersResponse(items: unknown[], meta?: Partial<{ page: number; totalPages: number; total: number }>) {
  return {
    success: true,
    data: items,
    meta: { page: 1, limit: 20, total: items.length, totalPages: 1, ...meta },
  }
}

function buildOrder(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'order-1',
    orderNumber: 'PF-000001',
    status: 'PENDING_PAYMENT',
    total: '199.00',
    currency: 'INR',
    itemCount: 1,
    needsManualRefund: false,
    recipientName: 'Riya Sharma',
    createdAt: '2026-08-27T14:27:57.215Z',
    ...overrides,
  }
}

function adminOrdersCalls(mock: MockAdapter) {
  return mock.history.get.filter((r) => r.url === '/admin/orders')
}

const VALID_UUID = '11111111-1111-4111-8111-111111111111'

describe('AdminOrdersPage', () => {
  let mock: MockAdapter

  beforeEach(() => {
    mock = new MockAdapter(apiClient)
  })

  afterEach(() => {
    mock.restore()
  })

  it('lists every order in the system (unscoped by customer) and links each into the admin detail route', async () => {
    mock.onGet('/admin/orders').reply(200, ordersResponse([buildOrder()]))

    renderWithProviders(<AdminOrdersPage />)

    const link = await screen.findByRole('link', { name: /PF-000001/ })
    expect(link).toHaveAttribute('href', '/admin/orders/order-1')
  })

  it('flags a needsManualRefund order in the list', async () => {
    mock.onGet('/admin/orders').reply(200, ordersResponse([buildOrder({ needsManualRefund: true })]))

    renderWithProviders(<AdminOrdersPage />)

    expect(await screen.findByText('Refund pending')).toBeInTheDocument()
  })

  it('shows real pagination driven by the backend meta, not client-side slicing', async () => {
    mock.onGet('/admin/orders').reply(200, ordersResponse([buildOrder()], { totalPages: 3 }))

    renderWithProviders(<AdminOrdersPage />)

    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument()
  })

  it('renders a semantic table with the expected column headers', async () => {
    mock.onGet('/admin/orders').reply(200, ordersResponse([buildOrder()]))

    renderWithProviders(<AdminOrdersPage />)

    await screen.findByRole('link', { name: /PF-000001/ })
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual(['Order', 'Customer', 'Date', 'Items', 'Photo', 'Status', 'Total'])
    expect(screen.getByRole('heading', { level: 1, name: 'Orders' })).toBeInTheDocument()
  })

  it('shows who each order is for', async () => {
    mock.onGet('/admin/orders').reply(200, ordersResponse([buildOrder({ recipientName: 'Neha Kulkarni' })]))
    renderWithProviders(<AdminOrdersPage />)

    const row = (await screen.findByRole('link', { name: /PF-000001/ })).closest('tr') as HTMLElement
    expect(within(row).getByText('Neha Kulkarni')).toBeInTheDocument()
  })

  it('shows a page-level skeleton (polite loading status) while the first fetch is in flight', () => {
    mock.onGet('/admin/orders').reply(() => new Promise(() => {}))

    renderWithProviders(<AdminOrdersPage />)

    expect(screen.getByText('Loading').closest('[role="status"]')).toBeInTheDocument()
  })

  it('surfaces a fetch error through the shared Alert (getApiErrorMessage)', async () => {
    mock.onGet('/admin/orders').reply(500)

    renderWithProviders(<AdminOrdersPage />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/something went wrong/i)
  })

  it('distinguishes a genuinely empty list from an empty filtered result', async () => {
    mock.onGet('/admin/orders').reply(200, ordersResponse([]))

    const { unmount } = renderWithProviders(<AdminOrdersPage />)
    expect(await screen.findByText('No orders yet')).toBeInTheDocument()
    unmount()

    renderWithProviders(<AdminOrdersPage />, { initialEntries: ['/admin/orders?status=PAID'] })
    expect(await screen.findByText('No orders match these filters')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Clear filters' }).length).toBeGreaterThanOrEqual(1)
  })

  it('has a status filter that adds ?status= and resets to page 1', async () => {
    const user = userEvent.setup()
    mock.onGet('/admin/orders').reply((config) => {
      const status = (config.params as { status?: string } | undefined)?.status
      return [200, ordersResponse(status === 'PAID' ? [buildOrder({ status: 'PAID' })] : [buildOrder()])]
    })

    renderWithProviders(<AdminOrdersPage />, { initialEntries: ['/admin/orders?page=3'] })

    await screen.findByRole('link', { name: /PF-000001/ })
    await user.selectOptions(screen.getByLabelText('Status'), 'PAID')

    await within(screen.getByRole('table')).findByText('Payment confirmed')
    const calls = adminOrdersCalls(mock).map((r) => r.params as Record<string, unknown>)
    expect(calls.at(-1)).toMatchObject({ status: 'PAID', page: 1 })
  })

  it('has status tabs that drive the same ?status= filter and mark the active view', async () => {
    const user = userEvent.setup()
    mock.onGet('/admin/orders').reply(200, ordersResponse([buildOrder()]))

    renderWithProviders(<AdminOrdersPage />, { initialEntries: ['/admin/orders?page=2'] })

    await screen.findByRole('link', { name: /PF-000001/ })
    const tabs = screen.getByRole('navigation', { name: 'Order views' })
    expect(within(tabs).getByRole('button', { name: 'All orders' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(within(tabs).getByRole('button', { name: 'In production' }))

    expect(within(tabs).getByRole('button', { name: 'In production' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(tabs).getByRole('button', { name: 'All orders' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByLabelText('Status')).toHaveValue('IN_PRODUCTION')
    const calls = adminOrdersCalls(mock).map((r) => r.params as Record<string, unknown>)
    expect(calls.at(-1)).toMatchObject({ status: 'IN_PRODUCTION', page: 1 })
  })

  it('has a Photo review tab that filters by photoReview, replaces the status filter, and shows each order\'s photo state', async () => {
    const user = userEvent.setup()
    mock.onGet('/admin/orders').reply(200, ordersResponse([buildOrder({ photoReview: 'TO_REVIEW' })]))

    renderWithProviders(<AdminOrdersPage />, { initialEntries: ['/admin/orders?status=SHIPPED'] })

    await screen.findByRole('link', { name: /PF-000001/ })
    const tabs = screen.getByRole('navigation', { name: 'Order views' })
    await user.click(within(tabs).getByRole('button', { name: 'Photo review' }))

    expect(within(tabs).getByRole('button', { name: 'Photo review' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Status')).toHaveValue('')
    const params = adminOrdersCalls(mock).map((r) => r.params as Record<string, unknown>).at(-1)
    expect(params).toMatchObject({ photoReview: 'TO_REVIEW', page: 1 })
    expect(params?.status).toBeUndefined()
    const row = screen.getByRole('link', { name: /PF-000001/ }).closest('tr') as HTMLElement
    expect(within(row).getByText('To review')).toBeInTheDocument()
  })

  it('"All orders" tab clears the status filter', async () => {
    const user = userEvent.setup()
    mock.onGet('/admin/orders').reply(200, ordersResponse([buildOrder({ status: 'SHIPPED' })]))

    renderWithProviders(<AdminOrdersPage />, { initialEntries: ['/admin/orders?status=SHIPPED'] })

    await screen.findByRole('link', { name: /PF-000001/ })
    const tabs = screen.getByRole('navigation', { name: 'Order views' })
    expect(within(tabs).getByRole('button', { name: 'Shipped' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(within(tabs).getByRole('button', { name: 'All orders' }))

    expect(screen.getByLabelText('Status')).toHaveValue('')
  })

  it('has date-range filters that pass dateFrom / dateTo through to the API', async () => {
    mock.onGet('/admin/orders').reply(200, ordersResponse([buildOrder()]))

    renderWithProviders(<AdminOrdersPage />)
    await screen.findByRole('link', { name: /PF-000001/ })

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-08-01' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-08-31' } })

    await screen.findByRole('link', { name: /PF-000001/ })
    const last = adminOrdersCalls(mock).at(-1)?.params as Record<string, unknown>
    expect(last).toMatchObject({ dateFrom: '2026-08-01', dateTo: '2026-08-31' })
  })

  it('validates the Customer ID filter client-side and never sends a malformed userId', async () => {
    const user = userEvent.setup()
    mock.onGet('/admin/orders').reply(200, ordersResponse([buildOrder()]))

    renderWithProviders(<AdminOrdersPage />)
    await screen.findByRole('link', { name: /PF-000001/ })

    await user.type(screen.getByLabelText('Customer ID'), 'not-a-uuid')
    expect(await screen.findByText('Enter a full customer UUID')).toBeInTheDocument()
    expect(
      adminOrdersCalls(mock).some((r) => (r.params as { userId?: string }).userId !== undefined),
    ).toBe(false)

    await user.clear(screen.getByLabelText('Customer ID'))
    await user.type(screen.getByLabelText('Customer ID'), VALID_UUID)
    await screen.findByRole('link', { name: /PF-000001/ })
    expect((adminOrdersCalls(mock).at(-1)?.params as { userId?: string }).userId).toBe(VALID_UUID)
  })

  it('pages through results with the shared AdminPagination control', async () => {
    const user = userEvent.setup()
    mock.onGet('/admin/orders').reply((config) => {
      const page = (config.params as { page?: string } | undefined)?.page ?? '1'
      return [200, ordersResponse([buildOrder({ orderNumber: `PF-PAGE-${page}` })], { page: Number(page), totalPages: 2 })]
    })

    renderWithProviders(<AdminOrdersPage />)
    await screen.findByRole('link', { name: /PF-PAGE-1/ })

    await user.click(screen.getByRole('button', { name: 'Next' }))

    await screen.findByRole('link', { name: /PF-PAGE-2/ })
    expect((adminOrdersCalls(mock).at(-1)?.params as { page?: number }).page).toBe(2)
  })

  it('keeps the order number as a plain accessible link (no whole-row navigation)', async () => {
    mock.onGet('/admin/orders').reply(200, ordersResponse([buildOrder()]))

    renderWithProviders(<AdminOrdersPage />)

    const row = (await screen.findByRole('link', { name: /PF-000001/ })).closest('tr')
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getAllByRole('link')).toHaveLength(1)
  })
})
