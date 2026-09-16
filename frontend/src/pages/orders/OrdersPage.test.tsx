import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import MockAdapter from 'axios-mock-adapter'
import type { AxiosRequestConfig } from 'axios'
import { apiClient } from '@/services/api/client'
import { renderWithProviders, createTestQueryClient } from '@/test/test-utils'
import type { OrderStatus } from '@/types/orders'
import { OrdersPage } from './OrdersPage'
import { OrderDetailPage } from './OrderDetailPage'

function buildOrder(overrides: Partial<{ id: string; orderNumber: string; status: OrderStatus; total: string; itemCount: number; createdAt: string }> = {}) {
  return {
    id: 'order-1',
    orderNumber: 'PF-000001',
    status: 'PAID' as OrderStatus,
    total: '349.00',
    currency: 'INR',
    itemCount: 2,
    needsManualRefund: false,
    createdAt: '2026-01-15T10:00:00.000Z',
    ...overrides,
  }
}

function ordersResponse(items: ReturnType<typeof buildOrder>[], meta?: Partial<{ page: number; limit: number; total: number; totalPages: number }>) {
  return {
    success: true,
    data: items,
    meta: { page: 1, limit: 20, total: items.length, totalPages: 1, ...meta },
  }
}

describe('OrdersPage', () => {
  let mock: MockAdapter

  beforeEach(() => {
    mock = new MockAdapter(apiClient)
  })

  afterEach(() => {
    mock.restore()
  })

  it('renders a loading skeleton while the request is in flight', async () => {
    mock.onGet('/orders').reply(() => new Promise((resolve) => setTimeout(() => resolve([200, ordersResponse([buildOrder()])]), 30)))

    renderWithProviders(<OrdersPage />)

    expect(screen.getByTestId('order-list-skeleton')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('order-list-skeleton')).not.toBeInTheDocument())
    expect(screen.getByText('PF-000001')).toBeInTheDocument()
  })

  it('renders its content inside the shared storefront Page shell (UX-40)', async () => {
    mock.onGet('/orders').reply(200, ordersResponse([buildOrder()]))

    renderWithProviders(<OrdersPage />)

    const heading = await screen.findByRole('heading', { level: 1, name: 'Your orders' })
    // Single wrapping <section> from the Page primitive — no double wrapper,
    // and the page's own <h1>/header stay page-owned inside it.
    const section = heading.closest('section')
    expect(section).not.toBeNull()
    expect(section?.className).toMatch(/page/i)
    expect(section?.querySelector('section')).toBeNull()
  })

  it('renders orders returned by the API: order number, date, status badge, item count, and total', async () => {
    mock.onGet('/orders').reply(200, ordersResponse([buildOrder({ status: 'PAID', itemCount: 3, total: '450.00' })]))

    renderWithProviders(<OrdersPage />)

    expect(await screen.findByText('PF-000001')).toBeInTheDocument()
    expect(screen.getByText('Payment confirmed')).toBeInTheDocument()
    expect(screen.getByText('3 items')).toBeInTheDocument()
    expect(screen.getByText('₹450.00')).toBeInTheDocument()
    expect(screen.getByText('15 Jan 2026')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel order' })).not.toBeInTheDocument()
  })

  it('links each row to the order detail page', async () => {
    mock.onGet('/orders').reply(200, ordersResponse([buildOrder()]))

    renderWithProviders(<OrdersPage />)

    const link = await screen.findByRole('link', { name: /PF-000001/ })
    expect(link).toHaveAttribute('href', '/orders/order-1')
  })

  it('lets the customer cancel an unpaid order from the list', async () => {
    const user = userEvent.setup()
    mock.onGet('/orders').reply(200, ordersResponse([buildOrder({ status: 'PENDING_PAYMENT' })]))
    mock.onPost('/orders/order-1/cancel').reply(200, {
      success: true,
      data: buildOrder({ status: 'CANCELLED' }),
    })

    renderWithProviders(<OrdersPage />)

    expect(await screen.findByRole('button', { name: 'Cancel order' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel order' }))
    await user.click(screen.getByRole('button', { name: 'Yes, cancel order' }))

    await waitFor(() =>
      expect(mock.history.post.some((r) => r.url === '/orders/order-1/cancel')).toBe(true),
    )
  })

  it('renders the empty-orders state (distinct from an error) when there are zero orders', async () => {
    mock.onGet('/orders').reply(200, ordersResponse([]))

    renderWithProviders(<OrdersPage />)

    expect(await screen.findByText('No orders yet')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renders a fetch-error state distinct from the empty state', async () => {
    mock.onGet('/orders').reply(500, {
      success: false,
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Something broke', details: [] },
    })

    renderWithProviders(<OrdersPage />)

    expect(await screen.findByText('Something broke')).toBeInTheDocument()
    expect(screen.queryByText('No orders yet')).not.toBeInTheDocument()
  })

  it('paginates using real page/limit params, not client-side slicing', async () => {
    const user = userEvent.setup()
    mock.onGet('/orders').reply((config: AxiosRequestConfig) => {
      const params = config.params as { page?: number } | undefined
      const page = Number(params?.page ?? 1)
      const order = page === 1 ? buildOrder({ id: 'order-1', orderNumber: 'PF-000001' }) : buildOrder({ id: 'order-2', orderNumber: 'PF-000002' })
      return [200, ordersResponse([order], { page, totalPages: 2, total: 2 })]
    })

    renderWithProviders(<OrdersPage />)

    expect(await screen.findByText('PF-000001')).toBeInTheDocument()
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText('PF-000002')).toBeInTheDocument()
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()

    const listCalls = mock.history.get.filter((r) => r.url === '/orders')
    expect(listCalls.map((r) => (r.params as { page?: number } | undefined)?.page)).toEqual([1, 2])
  })

  it('does not render pagination controls when there is only one page', async () => {
    mock.onGet('/orders').reply(200, ordersResponse([buildOrder()], { totalPages: 1 }))

    renderWithProviders(<OrdersPage />)

    await screen.findByText('PF-000001')
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
  })
})

/**
 * Proves the list genuinely routes into the real OrderDetailPage — not a
 * stub — and that page's existing polling behavior keeps working when
 * reached this way. OrderDetailPage.test.tsx already covers polling/retry
 * mechanics in depth; this only checks the handoff between the two pages.
 */
describe('OrdersPage -> OrderDetailPage integration', () => {
  let mock: MockAdapter

  beforeEach(() => {
    mock = new MockAdapter(apiClient)
  })

  afterEach(() => {
    mock.restore()
  })

  it('a PENDING_PAYMENT row navigates into the real OrderDetailPage, which polls it as usual', async () => {
    const user = userEvent.setup()
    mock.onGet('/orders').reply(200, ordersResponse([buildOrder({ status: 'PENDING_PAYMENT' })]))

    let orderDetailCallCount = 0
    mock.onGet('/orders/order-1').reply(() => {
      orderDetailCallCount += 1
      return [
        200,
        {
          success: true,
          data: {
            id: 'order-1',
            orderNumber: 'PF-000001',
            status: 'PENDING_PAYMENT',
            total: '349.00',
            currency: 'INR',
            itemCount: 2,
            needsManualRefund: false,
            subtotal: '300.00',
            shippingRecipientName: 'Jane Doe',
            shippingPhone: '9876543210',
            shippingAddressLine1: '123 Test St',
            shippingAddressLine2: null,
            shippingCity: 'Mumbai',
            shippingState: 'MH',
            shippingPostalCode: '400001',
            shippingCountry: 'India',
            items: [],
            statusHistory: [],
            paymentAttempts: [],
            createdAt: '2026-01-15T10:00:00.000Z',
          },
        },
      ]
    })

    const queryClient = createTestQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/orders']}>
          <Routes>
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/orders/:id" element={<OrderDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const link = await screen.findByRole('link', { name: /PF-000001/ })
    await user.click(link)

    // Landed on the real OrderDetailPage (its own heading format), not
    // a generic 404 or a stub.
    expect(await screen.findByRole('heading', { name: 'Order PF-000001' })).toBeInTheDocument()
    expect(screen.getByText('Awaiting payment')).toBeInTheDocument()
    expect(screen.getByText(/confirming your payment/i)).toBeInTheDocument()

    // useOrder's poll is still live on this page — confirm a second fetch
    // of the same order fires on its own (3s interval), proving polling
    // wasn't dropped by however this page was reached.
    await waitFor(() => expect(orderDetailCallCount).toBeGreaterThanOrEqual(2), { timeout: 5000 })
  })
})
