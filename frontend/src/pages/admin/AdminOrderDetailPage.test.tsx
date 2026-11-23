import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import MockAdapter from 'axios-mock-adapter'
import { apiClient } from '@/services/api/client'
import { createTestQueryClient } from '@/test/test-utils'
import { formatDate } from '@/utils/formatDate'
import type { OrderStatus } from '@/types/orders'
import { AdminOrderDetailPage } from './AdminOrderDetailPage'

function buildOrder(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'order-1',
    orderNumber: 'PF-000001',
    status: 'PAID' as OrderStatus,
    total: '349.00',
    currency: 'INR',
    itemCount: 2,
    needsManualRefund: false,
    subtotal: '300.00',
    shippingFee: '49.00',
    discountAmount: '0.00',
    taxableAmount: '300.00',
    taxAmount: '0.00',
    taxMode: 'EXCLUSIVE',
    taxRatePercent: null as string | null,
    couponCode: null as string | null,
    shippingRecipientName: 'Jane Doe',
    shippingPhone: '9876543210',
    shippingAddressLine1: '123 Test St',
    shippingAddressLine2: null,
    shippingCity: 'Mumbai',
    shippingState: 'MH',
    shippingPostalCode: '400001',
    shippingCountry: 'India',
    items: [
      {
        id: 'item-1',
        productId: 'prod-1',
        productName: 'Ceramic Mug',
        variantLabel: null,
        unitPrice: '150.00',
        quantity: 2,
        lineTotal: '300.00',
        customizations: [],
      },
    ],
    statusHistory: [
      {
        fromStatus: null,
        toStatus: 'PENDING_PAYMENT',
        changedByUserId: 'user-1',
        note: 'Order created from cart at checkout',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    paymentAttempts: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function renderPage() {
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin/orders/order-1']}>
        <Routes>
          <Route path="/admin/orders/:id" element={<AdminOrderDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function reply(mock: MockAdapter, overrides: Partial<Record<string, unknown>> = {}) {
  mock.onGet('/admin/orders/order-1').reply(200, { success: true, data: buildOrder(overrides) })
}

async function headerOf(name: string) {
  const heading = await screen.findByRole('heading', { level: 1, name })
  return heading.closest('header') as HTMLElement
}

describe('AdminOrderDetailPage', () => {
  let mock: MockAdapter

  beforeEach(() => {
    mock = new MockAdapter(apiClient)
  })

  afterEach(() => {
    mock.restore()
  })

  // ─── Preserved behaviours ───────────────────────────────────────────────

  it('renders the order, its items, shipping address, and status history', async () => {
    reply(mock)
    renderPage()

    const header = await headerOf('Order PF-000001')
    expect(within(header).getByText('Payment confirmed')).toBeInTheDocument()
    expect(screen.getByText('Ceramic Mug')).toBeInTheDocument()
    expect(screen.getByText(/123 Test St/)).toBeInTheDocument()
    expect(screen.getByText('Order created from cart at checkout')).toBeInTheDocument()
  })

  it('shows no discount row when no coupon was applied', async () => {
    reply(mock)
    renderPage()

    await screen.findByText('₹349.00')
    expect(screen.queryByText(/Discount/)).not.toBeInTheDocument()
  })

  it('shows the discount row with the coupon code when one was applied', async () => {
    reply(mock, { total: '319.00', discountAmount: '30.00', couponCode: 'SAVE10' })
    renderPage()

    await screen.findByText('₹319.00')
    expect(screen.getByText('SAVE10')).toBeInTheDocument()
    expect(screen.getByText('−₹30.00')).toBeInTheDocument()
  })

  it('shows a manual-refund banner only when needsManualRefund is true', async () => {
    reply(mock, { needsManualRefund: true })
    renderPage()

    expect(await screen.findByText(/refund pending manual processing/i)).toBeInTheDocument()
  })

  it('offers every order status as a candidate, not just ones legal from the current status', async () => {
    reply(mock, { status: 'PENDING_PAYMENT' })
    renderPage()

    const select = await screen.findByLabelText('Change status')
    expect(within(select).getByRole('option', { name: 'Delivered' })).toBeInTheDocument()
    expect(within(select).getAllByRole('option')).toHaveLength(9)
  })

  it('status-change happy path: submits the picked status and reflects it without a manual refetch', async () => {
    const user = userEvent.setup()
    reply(mock, { status: 'PENDING_PAYMENT' })
    mock
      .onPatch('/admin/orders/order-1/status')
      .reply(200, { success: true, data: buildOrder({ status: 'PAID' }) })

    renderPage()

    const select = await screen.findByLabelText('Change status')
    await user.selectOptions(select, 'Payment confirmed')
    await user.click(screen.getByRole('button', { name: 'Update status' }))

    await waitFor(() => expect(mock.history.patch).toHaveLength(1))
    expect(JSON.parse(mock.history.patch[0].data as string)).toEqual({ status: 'PAID' })
    await waitFor(() => expect(screen.getAllByText('Payment confirmed').length).toBeGreaterThan(0))
  })

  it('status-change rejection is surfaced from the backend, not pre-validated client-side', async () => {
    const user = userEvent.setup()
    reply(mock, { status: 'PENDING_PAYMENT' })
    mock.onPatch('/admin/orders/order-1/status').reply(409, {
      success: false,
      error: {
        code: 'CONFLICT',
        message: 'Illegal order transition: PENDING_PAYMENT -> DELIVERED',
        details: [],
      },
    })

    renderPage()

    const select = await screen.findByLabelText('Change status')
    await user.selectOptions(select, 'Delivered')
    const submitButton = screen.getByRole('button', { name: 'Update status' })
    expect(submitButton).not.toBeDisabled()
    await user.click(submitButton)

    expect(
      await screen.findByText('Illegal order transition: PENDING_PAYMENT -> DELIVERED'),
    ).toBeInTheDocument()
    const header = await headerOf('Order PF-000001')
    expect(within(header).getByText('Awaiting payment')).toBeInTheDocument()
  })

  it('includes a reason in the PATCH body only when one was typed', async () => {
    const user = userEvent.setup()
    reply(mock, { status: 'PENDING_PAYMENT' })
    mock
      .onPatch('/admin/orders/order-1/status')
      .reply(200, { success: true, data: buildOrder({ status: 'PAID' }) })

    renderPage()

    const select = await screen.findByLabelText('Change status')
    await user.selectOptions(select, 'Payment confirmed')
    await user.type(screen.getByLabelText('Reason (optional)'), 'Manually confirmed after bank transfer')
    await user.click(screen.getByRole('button', { name: 'Update status' }))

    await waitFor(() => expect(mock.history.patch).toHaveLength(1))
    expect(JSON.parse(mock.history.patch[0].data as string)).toEqual({
      status: 'PAID',
      reason: 'Manually confirmed after bank transfer',
    })
  })

  // ─── Redesign structure ─────────────────────────────────────────────────

  it('renders exactly one h1 with the order number and the placed date', async () => {
    reply(mock)
    renderPage()

    await screen.findByText('Ceramic Mug')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Order PF-000001')
    expect(screen.getByText(`Placed ${formatDate('2026-01-01T00:00:00.000Z')}`)).toBeInTheDocument()
  })

  it('links back to the orders list via a breadcrumb', async () => {
    reply(mock)
    renderPage()

    await screen.findByText('Ceramic Mug')
    expect(screen.getByRole('link', { name: 'Orders' })).toHaveAttribute('href', '/admin/orders')
  })

  it('renders the order items as a semantic table with the expected columns and values', async () => {
    reply(mock)
    renderPage()

    const table = await screen.findByRole('table', { name: 'Order items' })
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Product', 'Qty', 'Unit price', 'Line total'])

    const row = within(table).getByText('Ceramic Mug').closest('tr') as HTMLElement
    expect(within(row).getByText('2')).toBeInTheDocument()
    expect(within(row).getByText('₹150.00')).toBeInTheDocument()
    expect(within(row).getByText('₹300.00')).toBeInTheDocument()
  })

  it('links an order-item product into the admin product detail route when a productId exists', async () => {
    reply(mock)
    renderPage()

    const link = await screen.findByRole('link', { name: 'Ceramic Mug' })
    expect(link).toHaveAttribute('href', '/admin/products/prod-1')
  })

  it('renders a product with no productId as plain text (no link)', async () => {
    reply(mock, {
      items: [
        {
          id: 'item-x',
          productId: null,
          productName: 'Deleted product',
          variantLabel: null,
          unitPrice: '10.00',
          quantity: 1,
          lineTotal: '10.00',
          customizations: [],
        },
      ],
    })
    renderPage()

    expect(await screen.findByText('Deleted product')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Deleted product' })).not.toBeInTheDocument()
  })

  it('shows item customizations under the product name', async () => {
    reply(mock, {
      items: [
        {
          id: 'item-c',
          productId: 'prod-2',
          productName: 'Custom Tee',
          variantLabel: 'Large',
          unitPrice: '400.00',
          quantity: 1,
          lineTotal: '400.00',
          customizations: [
            { id: 'c-1', fieldLabel: 'Front text', textValue: 'PrintForge', uploadedFileId: null, reviewStatus: null, reviewNote: null },
            { id: 'c-2', fieldLabel: 'Logo', textValue: null, uploadedFileId: 'file-1', reviewStatus: 'PENDING', reviewNote: null },
          ],
        },
      ],
    })
    renderPage()

    // The name also heads the photo-review card now; the Items row is the one in the table.
    const row = (await screen.findAllByText('Custom Tee'))
      .map((el) => el.closest('tr'))
      .find((tr): tr is HTMLTableRowElement => tr !== null) as HTMLElement
    expect(within(row).getByText('Large')).toBeInTheDocument()
    expect(within(row).getByText('Front text: PrintForge')).toBeInTheDocument()
    expect(within(row).getByText('Logo: Uploaded file')).toBeInTheDocument()
  })

  it('links the delivery pin the customer shared to Google Maps', async () => {
    reply(mock, { deliveryPin: { latitude: 18.45751, longitude: 73.85081 } })
    renderPage()

    const link = await screen.findByRole('link', { name: 'Open in Google Maps' })
    expect(link).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=18.45751,73.85081')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(screen.getByText('18.45751, 73.85081')).toBeInTheDocument()
  })

  it('shows no pin section when the customer did not share one', async () => {
    reply(mock, { deliveryPin: null })
    renderPage()
    await screen.findByText('Jane Doe')
    expect(screen.queryByRole('link', { name: 'Open in Google Maps' })).not.toBeInTheDocument()
  })

  it('renders a financial summary using backend values (no client calculation)', async () => {
    reply(mock)
    renderPage()

    const summary = (await screen.findByText('Subtotal')).closest('dl') as HTMLElement
    expect(within(summary).getByText('₹300.00')).toBeInTheDocument()
    expect(within(within(summary).getByText('Shipping').closest('div')!).getByText('₹49.00')).toBeInTheDocument()
    expect(within(within(summary).getByText('Total').closest('div')!).getByText('₹349.00')).toBeInTheDocument()
  })

  it('shows a GST row only when the backend reports tax', async () => {
    reply(mock)
    const { unmount } = renderPage()
    await screen.findByText('Subtotal')
    expect(screen.queryByText(/GST/)).not.toBeInTheDocument()
    unmount()

    reply(mock, { taxAmount: '54.00', taxRatePercent: '18', total: '403.00' })
    renderPage()
    expect(await screen.findByText('GST (18%)')).toBeInTheDocument()
    expect(screen.getByText('₹54.00')).toBeInTheDocument()
  })

  it('renders the shipping address in an <address> element', async () => {
    reply(mock)
    const { container } = renderPage()

    await screen.findByText('123 Test St')
    const address = container.querySelector('address') as HTMLElement
    expect(address).not.toBeNull()
    expect(within(address).getByText('Jane Doe')).toBeInTheDocument()
    expect(within(address).getByText('9876543210')).toBeInTheDocument()
    expect(within(address).getByText('Mumbai, MH 400001')).toBeInTheDocument()
  })

  it('renders status history as a semantic table', async () => {
    reply(mock, {
      statusHistory: [
        {
          fromStatus: null,
          toStatus: 'PENDING_PAYMENT',
          changedByUserId: 'user-1',
          note: 'Order created from cart at checkout',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          fromStatus: 'PENDING_PAYMENT',
          toStatus: 'PAID',
          changedByUserId: 'admin-1',
          note: null,
          createdAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    })
    renderPage()

    const table = await screen.findByRole('table', { name: 'Order status history' })
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Change', 'When', 'Note'])
    expect(within(table).getByText('Order created from cart at checkout')).toBeInTheDocument()
    expect(within(table).getByText('from Awaiting payment')).toBeInTheDocument()
    expect(within(table).getByText(formatDate('2026-01-02T00:00:00.000Z'))).toBeInTheDocument()
  })

  it('renders a payment-attempts table only when there are attempts', async () => {
    reply(mock)
    const { unmount } = renderPage()
    await screen.findByText('Ceramic Mug')
    expect(screen.queryByRole('table', { name: 'Payment attempts' })).not.toBeInTheDocument()
    unmount()

    reply(mock, {
      paymentAttempts: [
        {
          id: 'pa-1',
          status: 'FAILED',
          amountPaise: '34900',
          method: 'upi',
          failureCode: 'BAD_VPA',
          failureReason: 'Payment declined by bank',
          createdAt: '2026-01-01T00:05:00.000Z',
          capturedAt: null,
          refunds: [],
        },
      ],
    })
    renderPage()

    const table = await screen.findByRole('table', { name: 'Payment attempts' })
    expect(within(table).getByText('FAILED')).toBeInTheDocument()
    expect(within(table).getByText('₹349.00')).toBeInTheDocument()
    expect(within(table).getByText('upi')).toBeInTheDocument()
    expect(within(table).getByText('Payment declined by bank')).toBeInTheDocument()
  })

  // ─── Destructive-transition confirmation ────────────────────────────────

  it('asks for confirmation before moving an order to Cancelled', async () => {
    const user = userEvent.setup()
    reply(mock, { status: 'PENDING_PAYMENT' })
    mock
      .onPatch('/admin/orders/order-1/status')
      .reply(200, { success: true, data: buildOrder({ status: 'CANCELLED' }) })

    renderPage()

    await user.selectOptions(await screen.findByLabelText('Change status'), 'Cancelled')
    await user.click(screen.getByRole('button', { name: 'Update status' }))

    const dialog = screen.getByRole('dialog', { name: 'Cancel this order?' })
    expect(mock.history.patch).toHaveLength(0)

    await user.click(within(dialog).getByRole('button', { name: 'Keep as is' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mock.history.patch).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Update status' }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel order' }),
    )

    await waitFor(() => expect(mock.history.patch).toHaveLength(1))
    expect(JSON.parse(mock.history.patch[0].data as string)).toEqual({ status: 'CANCELLED' })
  })

  it('asks for confirmation before marking an order Refunded', async () => {
    const user = userEvent.setup()
    reply(mock, { status: 'PAID' })
    mock
      .onPatch('/admin/orders/order-1/status')
      .reply(200, { success: true, data: buildOrder({ status: 'REFUNDED' }) })

    renderPage()

    await user.selectOptions(await screen.findByLabelText('Change status'), 'Refunded')
    await user.click(screen.getByRole('button', { name: 'Update status' }))
    expect(screen.getByRole('dialog', { name: 'Mark this order as refunded?' })).toBeInTheDocument()
    expect(mock.history.patch).toHaveLength(0)

    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark refunded' }),
    )
    await waitFor(() => expect(mock.history.patch).toHaveLength(1))
    expect(JSON.parse(mock.history.patch[0].data as string)).toEqual({ status: 'REFUNDED' })
  })

  // ─── States ────────────────────────────────────────────────────────────

  it('shows a page-level skeleton (polite loading status) while loading', () => {
    mock.onGet('/admin/orders/order-1').reply(() => new Promise(() => {}))
    renderPage()

    expect(screen.getByText('Loading').closest('[role="status"]')).toBeInTheDocument()
    expect(screen.queryByText('Ceramic Mug')).not.toBeInTheDocument()
  })

  it('surfaces a fetch error through the shared Alert inside the page shell', async () => {
    mock.onGet('/admin/orders/order-1').reply(404, {
      success: false,
      error: { code: 'NOT_FOUND', message: 'Order not found', details: [] },
    })
    renderPage()

    expect(await screen.findByText('Order not found')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Order')
    // Recovery: an in-body link back to the list, plus the breadcrumb.
    expect(screen.getByRole('link', { name: 'Back to orders' })).toHaveAttribute(
      'href',
      '/admin/orders',
    )
    expect(screen.getByRole('link', { name: 'Orders' })).toHaveAttribute('href', '/admin/orders')
  })

  it('shows the invoice link only for an invoiceable status', async () => {
    reply(mock, { status: 'PENDING_PAYMENT' })
    const { unmount } = renderPage()
    await screen.findByText('Ceramic Mug')
    expect(screen.queryByRole('link', { name: 'View invoice' })).not.toBeInTheDocument()
    unmount()

    reply(mock, { status: 'SHIPPED' })
    renderPage()
    const link = await screen.findByRole('link', { name: 'View invoice' })
    expect(link).toHaveAttribute('href', '/orders/order-1/invoice')
  })

  // ─── Negative assertions ───────────────────────────────────────────────

  it('has no search, filters, date-range, charts, refund action, or raw JSON', async () => {
    reply(mock)
    renderPage()

    await screen.findByText('Ceramic Mug')
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('figure')).not.toBeInTheDocument()
    expect(document.querySelector('canvas')).toBeNull()
    expect(screen.queryByText(/^\{/)).not.toBeInTheDocument()
    // The only combobox is the status control.
    expect(screen.getAllByRole('combobox')).toHaveLength(1)
    // No in-app refund action — only the informational banner text.
    expect(screen.queryByRole('button', { name: /refund/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/date range|start date|end date/i)).not.toBeInTheDocument()
  })
})
