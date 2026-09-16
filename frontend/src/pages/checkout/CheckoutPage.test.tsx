import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import MockAdapter from 'axios-mock-adapter'
import { apiClient } from '@/services/api/client'
import { AuthContext } from '@/features/auth/authContext'
import { ToastProvider } from '@/components/ui/toast/ToastProvider'
import { createMockAuthContext, createTestQueryClient } from '@/test/test-utils'
import type { RazorpayCheckoutOptions } from '@/types/razorpay'
import { CheckoutPage } from './CheckoutPage'
import layoutStyles from './CheckoutPage.module.css'
import couponStyles from '@/features/checkout/CouponForm.module.css'

const AUTH_VALUE = createMockAuthContext({
  status: 'authenticated',
  user: { id: 'user-1', email: 'shopper@example.test', role: 'CUSTOMER', createdAt: '2026-01-01T00:00:00.000Z' },
})

function buildCart() {
  return {
    id: 'cart-1',
    items: [
      {
        id: 'item-1',
        productId: 'prod-1',
        productName: 'Ceramic Mug',
        variantId: null,
        variantLabel: null,
        quantity: 2,
        unitPrice: '150.00',
        lineTotal: '300.00',
        isAvailable: true,
        unavailableReason: null,
        customizations: [],
      },
    ],
    itemCount: 2,
    subtotal: '300.00',
  }
}

const PROFILE_NO_ADDRESS = {
  id: 'user-1',
  email: 'shopper@example.test',
  addressLine1: null,
  addressLine2: null,
  city: null,
  state: null,
  postalCode: null,
  country: null,
  phone: null,
  role: 'CUSTOMER',
  createdAt: '2026-01-01T00:00:00.000Z',
}

const PROFILE_WITH_ADDRESS = {
  ...{
    id: 'user-1',
    email: 'shopper@example.test',
    role: 'CUSTOMER',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  addressLine1: '221B Baker Street',
  addressLine2: null,
  city: 'Mumbai',
  state: 'MH',
  postalCode: '400001',
  country: 'India',
  phone: '9876543210',
}

/** Base (no-coupon) preview shape returned by POST /checkout/validate — the
 * total the customer sees before payment (UX-06). */
const BASE_PREVIEW = {
  subtotal: '300.00',
  shippingFee: '49.00',
  discountAmount: '0.00',
  taxableAmount: '300.00',
  taxAmount: '0.00',
  taxMode: 'INCLUSIVE',
  total: '349.00',
  couponCode: null,
}

const ORDER_VIEW = {
  id: 'order-1',
  orderNumber: 'PF-000001',
  status: 'PENDING_PAYMENT',
  subtotal: '300.00',
  shippingFee: '49.00',
  total: '349.00',
  discountAmount: '0.00',
  couponCode: null,
  currency: 'INR',
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
  createdAt: '2026-01-01T00:00:00.000Z',
}

const PAYMENT_VIEW = {
  paymentAttemptId: 'pa-1',
  razorpayOrderId: 'order_rzp_1',
  razorpayKeyId: 'rzp_test_key',
  amountPaise: '34900',
  currency: 'INR',
}

/** Stands in for OrderDetailPage — proves navigation happened without
 * pulling that page's own dependencies/mocks into this test. */
function ConfirmationStub() {
  const { id } = useParams<{ id: string }>()
  return <div data-testid="confirmation-stub">Order {id}</div>
}

let checkoutMock: MockAdapter

function renderCheckout(
  profile: Record<string, unknown> = PROFILE_NO_ADDRESS,
  queryClient = createTestQueryClient(),
) {
  checkoutMock.onGet('/users/me').reply(200, { success: true, data: profile })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/checkout']}>
        <AuthContext.Provider value={AUTH_VALUE}>
          <ToastProvider>
            <Routes>
              <Route path="/checkout" element={<CheckoutPage />} />
              <Route path="/orders/:id" element={<ConfirmationStub />} />
            </Routes>
          </ToastProvider>
        </AuthContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const POSTAL_MUMBAI = {
  postalCode: '400001',
  city: 'Mumbai',
  district: 'Mumbai',
  state: 'Maharashtra',
  country: 'India',
}

async function fillShippingForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Recipient name'), 'Jane Doe')
  await user.type(screen.getByLabelText('Phone number'), '9876543210')
  await user.type(screen.getByLabelText('Address line 1'), '123 Test St')
  // City / State / Country are auto-filled from the PIN lookup (mocked in
  // beforeEach) — type the PIN last and wait for the autofill to land.
  await user.type(screen.getByLabelText('Postal code'), '400001')
  await waitFor(() => expect(screen.getByLabelText('City')).toHaveValue('Mumbai'))
}

interface CapturedInstance {
  options: RazorpayCheckoutOptions
  open: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
}

describe('CheckoutPage', () => {
  let mock: MockAdapter
  let razorpayInstances: CapturedInstance[]

  beforeEach(() => {
    mock = new MockAdapter(apiClient)
    checkoutMock = mock
    mock.onGet('/cart').reply(200, { success: true, data: buildCart() })
    mock.onGet('/orders').reply(200, {
      success: true,
      data: [],
      meta: { page: 1, limit: 1, total: 0, totalPages: 0 },
    })
    // /users/me is registered by renderCheckout() (per test, so the
    // address-prefill test can vary it); each test registers its own
    // /checkout/validate handler(s) — the shipping form renders whether
    // or not the base preview resolves.
    mock.onGet('/postal-codes/400001').reply(200, { success: true, data: POSTAL_MUMBAI })
    razorpayInstances = []
    // A plain `function`, not an arrow function — arrow functions have no
    // [[Construct]] slot, so `new Razorpay(...)` (openCheckout.ts) would
    // throw "is not a constructor" against a mock built from one.
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

  it('renders a shared error state under a "Checkout" heading when the cart fetch fails (UX-46)', async () => {
    mock.resetHandlers()
    mock.onGet('/cart').reply(500, {
      success: false,
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Something broke', details: [] },
    })
    mock.onGet('/users/me').reply(200, { success: true, data: PROFILE_NO_ADDRESS })
    mock.onGet('/orders').reply(200, {
      success: true,
      data: [],
      meta: { page: 1, limit: 1, total: 0, totalPages: 0 },
    })

    renderCheckout()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Something broke')
    expect(screen.getByRole('heading', { level: 1, name: 'Checkout' })).toBeInTheDocument()
    // no shipping form and no step indicator in the blocking error branch
    expect(screen.queryByLabelText('Recipient name')).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Checkout progress' })).not.toBeInTheDocument()
  })

  it('keeps the two-column grid and the coupon input row able to shrink on a narrow viewport (no horizontal overflow)', async () => {
    mock.onPost('/checkout/validate').reply(200, {
      success: true,
      data: { subtotal: '300.00', discountAmount: '0.00', shippingFee: '0.00', taxAmount: '0.00', taxMode: 'NONE', total: '300.00', couponCode: null },
    })

    renderCheckout()
    await screen.findByLabelText('Recipient name')

    // The <=720px layout collapses .layout to a single 1fr column; both grid
    // children and the CouponForm input row must carry min-width:0 or their
    // content min-content (the coupon input + "Apply") forces the page wider
    // than the viewport below ~386px. Layout isn't computed in jsdom, so we
    // assert the CSS contract that makes the collapse able to fit.
    const formColumn = document.querySelector<HTMLElement>(`.${layoutStyles.formColumn}`)
    const summaryColumn = document.querySelector<HTMLElement>(`.${layoutStyles.summaryColumn}`)
    const inputRow = screen
      .getByLabelText('Coupon code')
      .closest<HTMLElement>(`.${couponStyles.inputRow}`)

    expect(formColumn).not.toBeNull()
    expect(summaryColumn).not.toBeNull()
    expect(inputRow).not.toBeNull()
    expect(getComputedStyle(formColumn!).minWidth).toBe('0px')
    expect(getComputedStyle(summaryColumn!).minWidth).toBe('0px')
    // the flexible coupon-input child of the row, not the "Apply" button
    expect(getComputedStyle(inputRow!.firstElementChild as HTMLElement).minWidth).toBe('0px')
  })

  it('shows the checkout progress indicator and advances it from Delivery details to Payment (UX-41)', async () => {
    const user = userEvent.setup()
    mock.onPost('/checkout/orders').reply(201, { success: true, data: ORDER_VIEW })
    mock.onPost('/checkout/orders/order-1/retry-payment').reply(200, { success: true, data: PAYMENT_VIEW })

    renderCheckout()
    await screen.findByLabelText('Recipient name')

    const progress = screen.getByRole('list', { name: 'Checkout progress' })
    let steps = within(progress).getAllByRole('listitem')
    expect(steps[0]).toHaveAttribute('aria-current', 'step')
    expect(steps[1]).not.toHaveAttribute('aria-current')

    await fillShippingForm(user)
    await user.click(screen.getByRole('button', { name: 'Pay now' }))

    await screen.findByText(/awaiting payment/i)
    steps = within(screen.getByRole('list', { name: 'Checkout progress' })).getAllByRole('listitem')
    expect(steps[0]).toHaveTextContent('Completed:')
    expect(steps[1]).toHaveAttribute('aria-current', 'step')
  })

  it('reuses the same Idempotency-Key across a failed attempt and its retry within one page mount', async () => {
    const user = userEvent.setup()
    mock.onPost('/checkout/orders').replyOnce(500, {
      success: false,
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Something broke', details: [] },
    })
    mock.onPost('/checkout/orders').reply(201, { success: true, data: ORDER_VIEW })
    mock.onPost('/checkout/orders/order-1/retry-payment').reply(200, { success: true, data: PAYMENT_VIEW })

    renderCheckout()
    await screen.findByLabelText('Recipient name')
    await fillShippingForm(user)
    await user.click(screen.getByRole('button', { name: 'Pay now' }))

    await screen.findByText('Something broke')
    await user.click(screen.getByRole('button', { name: 'Pay now' }))

    await waitFor(() => expect(razorpayInstances).toHaveLength(1))

    const checkoutCalls = mock.history.post.filter((r) => r.url === '/checkout/orders')
    expect(checkoutCalls).toHaveLength(2)
    const key1 = checkoutCalls[0].headers?.['Idempotency-Key'] as string | undefined
    const key2 = checkoutCalls[1].headers?.['Idempotency-Key'] as string | undefined
    expect(key1).toBeTruthy()
    expect(key1).toBe(key2)
  })

  it('opens Razorpay Checkout.js after creating the order, and only navigates to the order confirmation page once /payments/verify responds', async () => {
    const user = userEvent.setup()
    mock.onPost('/checkout/orders').reply(201, { success: true, data: ORDER_VIEW })
    mock.onPost('/checkout/orders/order-1/retry-payment').reply(200, { success: true, data: PAYMENT_VIEW })
    mock.onPost('/payments/verify').reply(200, {
      success: true,
      data: { orderId: 'order-1', status: 'PAID' },
    })

    renderCheckout()
    await screen.findByLabelText('Recipient name')
    await fillShippingForm(user)
    await user.click(screen.getByRole('button', { name: 'Pay now' }))

    await waitFor(() => expect(razorpayInstances).toHaveLength(1))
    const { options } = razorpayInstances[0]
    expect(options.order_id).toBe('order_rzp_1')
    expect(options.key).toBe('rzp_test_key')
    expect(options.amount).toBe(34900)

    // Not navigated yet — the widget "succeeding" client-side isn't itself
    // proof of payment (§13.G); only a verify() response is.
    expect(screen.queryByTestId('confirmation-stub')).not.toBeInTheDocument()

    options.handler({
      razorpay_order_id: 'order_rzp_1',
      razorpay_payment_id: 'pay_1',
      razorpay_signature: 'sig_1',
    })

    await waitFor(() => {
      const verifyCall = mock.history.post.find((r) => r.url === '/payments/verify')
      expect(verifyCall).toBeDefined()
      expect(JSON.parse(verifyCall!.data as string)).toEqual({
        razorpay_order_id: 'order_rzp_1',
        razorpay_payment_id: 'pay_1',
        razorpay_signature: 'sig_1',
      })
    })

    expect(await screen.findByTestId('confirmation-stub')).toHaveTextContent('Order order-1')
  })

  it('keeps the order visible with a Retry Payment action when the Razorpay widget is dismissed, and retrying reuses the same order', async () => {
    const user = userEvent.setup()
    mock.onPost('/checkout/orders').reply(201, { success: true, data: ORDER_VIEW })
    mock.onPost('/checkout/orders/order-1/retry-payment').reply(200, { success: true, data: PAYMENT_VIEW })

    renderCheckout()
    await screen.findByLabelText('Recipient name')
    await fillShippingForm(user)
    await user.click(screen.getByRole('button', { name: 'Pay now' }))

    await waitFor(() => expect(razorpayInstances).toHaveLength(1))
    razorpayInstances[0].options.modal?.ondismiss?.()

    expect(await screen.findByText(/Payment was not completed/)).toBeInTheDocument()
    // The order itself is still shown — never looks like it vanished.
    expect(screen.getByText('Order PF-000001')).toBeInTheDocument()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry payment' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Retry payment' }))

    await waitFor(() => expect(razorpayInstances).toHaveLength(2))
    const retryPaymentCalls = mock.history.post.filter((r) => r.url === '/checkout/orders/order-1/retry-payment')
    expect(retryPaymentCalls).toHaveLength(2)
    // Retrying never re-submits a whole new checkout.
    expect(mock.history.post.filter((r) => r.url === '/checkout/orders')).toHaveLength(1)
  })

  it('does not fire two concurrent retry-payment requests on a synchronous double-click of Retry Payment', async () => {
    const user = userEvent.setup()
    mock.onPost('/checkout/orders').reply(201, { success: true, data: ORDER_VIEW })
    mock.onPost('/checkout/orders/order-1/retry-payment').reply(200, { success: true, data: PAYMENT_VIEW })

    renderCheckout()
    await screen.findByLabelText('Recipient name')
    await fillShippingForm(user)
    await user.click(screen.getByRole('button', { name: 'Pay now' }))

    // Auto-opened attempt settles, then gets dismissed so the button is
    // clickable again for the double-click below.
    await waitFor(() => expect(razorpayInstances).toHaveLength(1))
    razorpayInstances[0].options.modal?.ondismiss?.()
    const button = await screen.findByRole('button', { name: 'Retry payment' })

    // Deliberately NOT testing-library's fireEvent here: fireEvent
    // auto-wraps every dispatch in act(), which synchronously flushes
    // React's state update (and therefore the disabled-button DOM attribute)
    // before this function returns — that's a testing-tool guarantee, not
    // something a real browser gives two rapid physical clicks. Dispatching
    // raw native events lets React handle them via its normal scheduling,
    // which is what actually reproduces the race the disabled-button state
    // alone can't close (verified: this exact technique against the
    // pre-fix code produces 3 instances, not 2 — see the fix's commit).
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    await waitFor(() => expect(razorpayInstances).toHaveLength(2))
    // Give a would-be extra race call time to land before asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(razorpayInstances).toHaveLength(2)
    const retryPaymentCalls = mock.history.post.filter((r) => r.url === '/checkout/orders/order-1/retry-payment')
    // One from the auto-opened attempt, exactly one more from the
    // double-click — not two.
    expect(retryPaymentCalls).toHaveLength(2)
  })

  it('shows a server-authoritative total (subtotal + shipping + tax) before payment (UX-06)', async () => {
    mock.onPost('/checkout/validate').reply(200, { success: true, data: BASE_PREVIEW })

    renderCheckout()
    await screen.findByLabelText('Recipient name')

    // The full breakdown — not just the cart subtotal — is visible with no
    // coupon and before "Pay now".
    expect(await screen.findByText('₹349.00')).toBeInTheDocument()
    const validateCall = mock.history.post.find((r) => r.url === '/checkout/validate')
    expect(validateCall).toBeDefined()
    expect(JSON.parse(validateCall!.data as string)).toEqual({})
  })

  it('prefills the shipping form from the saved profile address, still editable (UX-07)', async () => {
    const user = userEvent.setup()
    mock.onPost('/checkout/validate').reply(200, { success: true, data: BASE_PREVIEW })

    renderCheckout(PROFILE_WITH_ADDRESS)

    const addressField = await screen.findByLabelText('Address line 1')
    expect(addressField).toHaveValue('221B Baker Street')
    expect(screen.getByLabelText('City')).toHaveValue('Mumbai')
    expect(screen.getByLabelText('Phone number')).toHaveValue('9876543210')
    expect(screen.getByText(/Prefilled from your saved address/)).toBeInTheDocument()

    await user.clear(addressField)
    await user.type(addressField, '10 Downing Street')
    expect(addressField).toHaveValue('10 Downing Street')
  })

  it('applies a coupon on submit (not on keystroke) and shows the returned discount/shipping/total preview', async () => {
    const user = userEvent.setup()
    // Specific { couponCode } matcher first, base ({}) fallback second.
    mock.onPost('/checkout/validate', { couponCode: 'save10' }).reply(200, {
      success: true,
      data: { ...BASE_PREVIEW, discountAmount: '30.00', total: '319.00', couponCode: 'SAVE10' },
    })
    mock.onPost('/checkout/validate').reply(200, { success: true, data: BASE_PREVIEW })

    renderCheckout()
    await screen.findByLabelText('Recipient name')

    const couponValidateCalls = () =>
      mock.history.post.filter(
        (r) =>
          r.url === '/checkout/validate' &&
          Boolean((JSON.parse(r.data as string) as { couponCode?: string }).couponCode),
      )

    // The coupon code is an optional supplemental action, not a required
    // checkout field — no required indicator (UX-46).
    expect(screen.getByLabelText('Coupon code')).not.toHaveAttribute('aria-required')

    await user.type(screen.getByLabelText('Coupon code'), 'save10')
    expect(couponValidateCalls()).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Apply' }))

    // Applied state: the code shows and can be removed.
    expect(await screen.findByRole('button', { name: 'Remove' })).toBeInTheDocument()
    expect(screen.getAllByText('SAVE10').length).toBeGreaterThanOrEqual(1)
    // Breakdown reflects the discounted total.
    expect(screen.getByText('−₹30.00')).toBeInTheDocument()
    expect(screen.getByText('₹319.00')).toBeInTheDocument()
    expect(couponValidateCalls()).toHaveLength(1)
    expect(JSON.parse(couponValidateCalls()[0].data as string)).toEqual({ couponCode: 'save10' })
  })

  it("surfaces the backend's specific coupon rejection message, not a generic one", async () => {
    const user = userEvent.setup()
    mock.onPost('/checkout/validate', { couponCode: 'OLDCODE' }).reply(400, {
      success: false,
      error: { code: 'BAD_REQUEST', message: 'This coupon has expired', details: [] },
    })
    mock.onPost('/checkout/validate').reply(200, { success: true, data: BASE_PREVIEW })

    renderCheckout()
    await screen.findByLabelText('Recipient name')

    await user.type(screen.getByLabelText('Coupon code'), 'OLDCODE')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(await screen.findByText('This coupon has expired')).toBeInTheDocument()
  })

  it('passes the applied coupon code through to the real order, and the confirmation page shows the discount', async () => {
    const user = userEvent.setup()
    mock.onPost('/checkout/validate', { couponCode: 'save10' }).reply(200, {
      success: true,
      data: { ...BASE_PREVIEW, discountAmount: '30.00', total: '319.00', couponCode: 'SAVE10' },
    })
    mock.onPost('/checkout/validate').reply(200, { success: true, data: BASE_PREVIEW })
    mock.onPost('/checkout/orders').reply(201, {
      success: true,
      data: { ...ORDER_VIEW, total: '319.00', discountAmount: '30.00', couponCode: 'SAVE10' },
    })
    mock.onPost('/checkout/orders/order-1/retry-payment').reply(200, {
      success: true,
      data: { ...PAYMENT_VIEW, amountPaise: '31900' },
    })

    renderCheckout()
    await screen.findByLabelText('Recipient name')

    await user.type(screen.getByLabelText('Coupon code'), 'save10')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    await screen.findByText('₹319.00')

    await fillShippingForm(user)
    await user.click(screen.getByRole('button', { name: 'Pay now' }))

    await waitFor(() => expect(mock.history.post.filter((r) => r.url === '/checkout/orders')).toHaveLength(1))
    const orderCall = mock.history.post.find((r) => r.url === '/checkout/orders')!
    expect(JSON.parse(orderCall.data as string)).toMatchObject({ couponCode: 'SAVE10' })

    await waitFor(() => expect(razorpayInstances).toHaveLength(1))
    expect(razorpayInstances[0].options.amount).toBe(31900)

    // Order confirmation shows the discount — a real coupon was applied.
    expect(await screen.findByText('SAVE10')).toBeInTheDocument()
    expect(screen.getByText('−₹30.00')).toBeInTheDocument()
  })

  it('resumes an unpaid order that already has a coupon so Razorpay is not opened against the undiscounted cart total', async () => {
    const unpaid = {
      ...ORDER_VIEW,
      total: '319.00',
      discountAmount: '30.00',
      couponCode: 'SAVE10',
      taxableAmount: '270.00',
      taxAmount: '0.00',
      taxMode: 'INCLUSIVE',
      taxRatePercent: null,
      itemCount: 1,
      needsManualRefund: false,
    }
    mock.onGet('/orders').reply((config) => {
      const status = (config.params as { status?: string } | undefined)?.status
      if (status === 'PENDING_PAYMENT') {
        return [
          200,
          {
            success: true,
            data: [
              {
                id: unpaid.id,
                orderNumber: unpaid.orderNumber,
                status: unpaid.status,
                total: unpaid.total,
                currency: unpaid.currency,
                itemCount: 1,
                needsManualRefund: false,
                createdAt: unpaid.createdAt,
              },
            ],
            meta: { page: 1, limit: 1, total: 1, totalPages: 1 },
          },
        ]
      }
      return [
        200,
        { success: true, data: [], meta: { page: 1, limit: 1, total: 0, totalPages: 0 } },
      ]
    })
    mock.onGet('/orders/order-1').reply(200, { success: true, data: unpaid })
    mock.onPost('/checkout/orders/order-1/retry-payment').reply(200, {
      success: true,
      data: { ...PAYMENT_VIEW, amountPaise: '31900' },
    })

    renderCheckout()

    expect(await screen.findByText(/awaiting payment/i)).toBeInTheDocument()
    expect(screen.getByText('SAVE10')).toBeInTheDocument()
    expect(screen.getByText('−₹30.00')).toBeInTheDocument()
    expect(screen.getByText('₹319.00')).toBeInTheDocument()
    expect(screen.queryByLabelText('Coupon code')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Recipient name')).not.toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Pay now' }))
    await waitFor(() => expect(razorpayInstances).toHaveLength(1))
    expect(razorpayInstances[0].options.amount).toBe(31900)
    expect(mock.history.post.filter((r) => r.url === '/checkout/orders')).toHaveLength(0)
  })

  it('does not resume an unpaid order after the cart gains another product', async () => {
    mock.onGet('/cart').reply(200, {
      success: true,
      data: {
        ...buildCart(),
        items: [
          ...buildCart().items,
          {
            id: 'item-2',
            productId: 'prod-2',
            productName: 'Poster',
            variantId: null,
            variantLabel: null,
            quantity: 1,
            unitPrice: '80.00',
            lineTotal: '80.00',
            isAvailable: true,
            unavailableReason: null,
            customizations: [],
          },
        ],
        itemCount: 3,
        subtotal: '380.00',
      },
    })
    mock.onGet('/orders').reply((config) => {
      const status = (config.params as { status?: string } | undefined)?.status
      if (status === 'PENDING_PAYMENT') {
        return [
          200,
          {
            success: true,
            data: [
              {
                id: ORDER_VIEW.id,
                orderNumber: ORDER_VIEW.orderNumber,
                status: ORDER_VIEW.status,
                total: ORDER_VIEW.total,
                currency: ORDER_VIEW.currency,
                itemCount: 1,
                needsManualRefund: false,
                createdAt: ORDER_VIEW.createdAt,
              },
            ],
            meta: { page: 1, limit: 1, total: 1, totalPages: 1 },
          },
        ]
      }
      return [
        200,
        { success: true, data: [], meta: { page: 1, limit: 1, total: 0, totalPages: 0 } },
      ]
    })
    mock.onGet('/orders/order-1').reply(200, { success: true, data: ORDER_VIEW })
    mock.onPost('/checkout/validate').reply(200, { success: true, data: BASE_PREVIEW })

    renderCheckout()

    expect(await screen.findByLabelText('Recipient name')).toBeInTheDocument()
    expect(screen.getByText('Poster')).toBeInTheDocument()
    expect(screen.queryByText(/awaiting payment/i)).not.toBeInTheDocument()
  })

  it('does not resume a cached unpaid order after the fresh cart fetch includes another product', async () => {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(['cart'], buildCart())
    mock.onGet('/cart').reply(200, {
      success: true,
      data: {
        ...buildCart(),
        items: [
          ...buildCart().items,
          {
            id: 'item-2',
            productId: 'prod-2',
            productName: 'Poster',
            variantId: null,
            variantLabel: null,
            quantity: 1,
            unitPrice: '80.00',
            lineTotal: '80.00',
            isAvailable: true,
            unavailableReason: null,
            customizations: [],
          },
        ],
        itemCount: 3,
        subtotal: '380.00',
      },
    })
    mock.onGet('/orders').reply((config) => {
      const status = (config.params as { status?: string } | undefined)?.status
      if (status === 'PENDING_PAYMENT') {
        return [
          200,
          {
            success: true,
            data: [
              {
                id: ORDER_VIEW.id,
                orderNumber: ORDER_VIEW.orderNumber,
                status: ORDER_VIEW.status,
                total: ORDER_VIEW.total,
                currency: ORDER_VIEW.currency,
                itemCount: 1,
                needsManualRefund: false,
                createdAt: ORDER_VIEW.createdAt,
              },
            ],
            meta: { page: 1, limit: 1, total: 1, totalPages: 1 },
          },
        ]
      }
      return [
        200,
        { success: true, data: [], meta: { page: 1, limit: 1, total: 0, totalPages: 0 } },
      ]
    })
    mock.onGet('/orders/order-1').reply(200, { success: true, data: ORDER_VIEW })
    mock.onPost('/checkout/validate').reply(200, { success: true, data: BASE_PREVIEW })

    renderCheckout(PROFILE_NO_ADDRESS, queryClient)

    expect(await screen.findByLabelText('Recipient name')).toBeInTheDocument()
    expect(screen.getByText('Poster')).toBeInTheDocument()
    expect(screen.queryByText(/awaiting payment/i)).not.toBeInTheDocument()
  })

  it('cancels the unpaid order from checkout so the current cart can be paid instead', async () => {
    mock.onGet('/orders').reply((config) => {
      const status = (config.params as { status?: string } | undefined)?.status
      if (status === 'PENDING_PAYMENT') {
        return [
          200,
          {
            success: true,
            data: [
              {
                id: ORDER_VIEW.id,
                orderNumber: ORDER_VIEW.orderNumber,
                status: ORDER_VIEW.status,
                total: ORDER_VIEW.total,
                currency: ORDER_VIEW.currency,
                itemCount: 1,
                needsManualRefund: false,
                createdAt: ORDER_VIEW.createdAt,
              },
            ],
            meta: { page: 1, limit: 1, total: 1, totalPages: 1 },
          },
        ]
      }
      return [
        200,
        { success: true, data: [], meta: { page: 1, limit: 1, total: 0, totalPages: 0 } },
      ]
    })
    mock.onGet('/orders/order-1').reply(200, { success: true, data: ORDER_VIEW })
    mock.onPost('/checkout/validate').reply(200, { success: true, data: BASE_PREVIEW })
    mock.onPost('/orders/order-1/cancel').reply(200, {
      success: true,
      data: { ...ORDER_VIEW, status: 'CANCELLED' },
    })

    renderCheckout()
    expect(await screen.findByText(/awaiting payment/i)).toBeInTheDocument()

    mock.onGet('/orders').reply(200, {
      success: true,
      data: [],
      meta: { page: 1, limit: 1, total: 0, totalPages: 0 },
    })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Cancel order' }))
    await user.click(screen.getByRole('button', { name: 'Yes, cancel order' }))

    expect(await screen.findByLabelText('Recipient name')).toBeInTheDocument()
    expect(screen.queryByText(/awaiting payment/i)).not.toBeInTheDocument()
    expect(mock.history.post.some((r) => r.url === '/orders/order-1/cancel')).toBe(true)
  })
})
