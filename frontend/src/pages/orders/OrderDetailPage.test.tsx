import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import MockAdapter from 'axios-mock-adapter'
import { apiClient } from '@/services/api/client'
import { createTestQueryClient } from '@/test/test-utils'
import type { OrderStatus } from '@/types/orders'
import type { RazorpayCheckoutOptions } from '@/types/razorpay'
import { OrderDetailPage } from './OrderDetailPage'

function buildOrder(status: OrderStatus) {
  return {
    id: 'order-1',
    orderNumber: 'PF-000001',
    status,
    total: '349.00',
    currency: 'INR',
    itemCount: 2,
    needsManualRefund: false,
    subtotal: '300.00',
    discountAmount: '0.00',
    couponCode: null,
    taxableAmount: '300.00',
    taxAmount: '0.00',
    taxMode: 'INCLUSIVE',
    taxRatePercent: null,
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
    statusHistory: [],
    paymentAttempts: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

const PAYMENT_VIEW = {
  paymentAttemptId: 'pa-1',
  razorpayOrderId: 'order_rzp_1',
  razorpayKeyId: 'rzp_test_key',
  amountPaise: '34900',
  currency: 'INR',
}

function renderOrderDetail() {
  const queryClient = createTestQueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/orders/order-1']}>
        <Routes>
          <Route path="/orders/:id" element={<OrderDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

interface CapturedInstance {
  options: RazorpayCheckoutOptions
  open: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
}

describe('OrderDetailPage', () => {
  let mock: MockAdapter
  let razorpayInstances: CapturedInstance[]

  beforeEach(() => {
    mock = new MockAdapter(apiClient)
    razorpayInstances = []
    window.Razorpay = vi.fn().mockImplementation(function (options: RazorpayCheckoutOptions) {
      const instance: CapturedInstance = { options, open: vi.fn(), on: vi.fn() }
      razorpayInstances.push(instance)
      return instance
    })
  })

  afterEach(() => {
    mock.restore()
    delete (window as { Razorpay?: unknown }).Razorpay
  })

  it('renders a shared error state (heading + assertive message + "All orders" link) when the order fetch fails', async () => {
    mock.onGet('/orders/order-1').reply(404, {
      success: false,
      error: { code: 'NOT_FOUND', message: 'Order not found', details: [] },
    })

    renderOrderDetail()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Order not found')
    expect(screen.getByRole('heading', { level: 1, name: 'Order' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /all orders/i })).toHaveAttribute('href', '/orders')
  })

  it('shows no discount row when no coupon was applied (discountAmount is "0.00", not null)', async () => {
    mock.onGet('/orders/order-1').reply(200, {
      success: true,
      data: { ...buildOrder('PAID'), discountAmount: '0.00', couponCode: null },
    })

    renderOrderDetail()

    await screen.findByText('₹349.00')
    expect(screen.queryByText(/Discount/)).not.toBeInTheDocument()
  })

  it('shows the discount row with the coupon code when one was applied', async () => {
    mock.onGet('/orders/order-1').reply(200, {
      success: true,
      data: { ...buildOrder('PAID'), total: '319.00', discountAmount: '30.00', couponCode: 'SAVE10' },
    })

    renderOrderDetail()

    await screen.findByText('₹319.00')
    expect(screen.getByText('SAVE10')).toBeInTheDocument()
    expect(screen.getByText('−₹30.00')).toBeInTheDocument()
  })

  it('renders the shipping fee, order timeline, and payment status when the API provides them', async () => {
    mock.onGet('/orders/order-1').reply(200, {
      success: true,
      data: {
        ...buildOrder('SHIPPED'),
        shippingFee: '49.00',
        total: '349.00',
        statusHistory: [
          { fromStatus: null, toStatus: 'PAID', changedByUserId: null, note: null, createdAt: '2026-01-01T00:00:00.000Z' },
          { fromStatus: 'PAID', toStatus: 'SHIPPED', changedByUserId: 'admin-1', note: 'Handed to courier', createdAt: '2026-01-03T00:00:00.000Z' },
        ],
        paymentAttempts: [
          { id: 'pa-1', status: 'CAPTURED', amountPaise: '34900', method: 'upi', failureCode: null, failureReason: null, createdAt: '2026-01-01T00:00:00.000Z', capturedAt: '2026-01-01T00:01:00.000Z', refunds: [] },
        ],
      },
    })

    renderOrderDetail()

    await screen.findByText('₹349.00')
    expect(screen.getByText('Shipping')).toBeInTheDocument()
    expect(screen.getByText('₹49.00')).toBeInTheDocument()
    expect(screen.getByText('Order timeline')).toBeInTheDocument()
    expect(screen.getByText('Handed to courier')).toBeInTheDocument()
    expect(screen.getByText(/Payment received/)).toBeInTheDocument()
  })

  it('never renders "Payment confirmed" for a still-PENDING_PAYMENT order, regardless of what the checkout flow assumed', async () => {
    mock.onGet('/orders/order-1').reply(200, { success: true, data: buildOrder('PENDING_PAYMENT') })

    renderOrderDetail()

    expect(await screen.findByText('Awaiting payment')).toBeInTheDocument()
    expect(screen.queryByText('Payment confirmed')).not.toBeInTheDocument()
    expect(screen.getByText(/confirming your payment/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pay now' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel order' })).toBeInTheDocument()
  })

  it('renders "Payment confirmed" only once the order\'s own status field says PAID, with no retry action', async () => {
    mock.onGet('/orders/order-1').reply(200, { success: true, data: buildOrder('PAID') })

    renderOrderDetail()

    expect(await screen.findByText('Payment confirmed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pay now|retry payment/i })).not.toBeInTheDocument()
  })

  it('offers Retry Payment for a PAYMENT_FAILED order and re-opens Razorpay Checkout.js for the same order on click', async () => {
    const user = userEvent.setup()
    mock.onGet('/orders/order-1').reply(200, { success: true, data: buildOrder('PAYMENT_FAILED') })
    mock.onPost('/checkout/orders/order-1/retry-payment').reply(200, { success: true, data: PAYMENT_VIEW })

    renderOrderDetail()

    expect(await screen.findByText('Payment failed')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry payment' }))

    await waitFor(() => expect(razorpayInstances).toHaveLength(1))
    expect(razorpayInstances[0].options.order_id).toBe('order_rzp_1')
    expect(mock.history.post.filter((r) => r.url === '/checkout/orders/order-1/retry-payment')).toHaveLength(1)
  })

  it('does not fire two concurrent retry-payment requests on a synchronous double-click of Retry Payment', async () => {
    mock.onGet('/orders/order-1').reply(200, { success: true, data: buildOrder('PAYMENT_FAILED') })
    mock.onPost('/checkout/orders/order-1/retry-payment').reply(200, { success: true, data: PAYMENT_VIEW })

    renderOrderDetail()

    const button = await screen.findByRole('button', { name: 'Retry payment' })

    // Deliberately NOT testing-library's fireEvent — it auto-wraps every
    // dispatch in act(), which synchronously flushes the disabled-button
    // DOM attribute before this function returns, masking the actual race
    // (a real browser gives no such synchronous-flush guarantee between two
    // rapid physical clicks). Raw native events let React handle them via
    // its normal scheduling, which is what genuinely reproduces the race —
    // see CheckoutPage.test.tsx's equivalent test for the verified proof.
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    await waitFor(() => expect(razorpayInstances).toHaveLength(1))
    // Give a would-be extra race call time to land before asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(razorpayInstances).toHaveLength(1)
    expect(mock.history.post.filter((r) => r.url === '/checkout/orders/order-1/retry-payment')).toHaveLength(1)
  })
})
