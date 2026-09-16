import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import MockAdapter from 'axios-mock-adapter'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import { AuthContext } from '@/features/auth/authContext'
import { createMockAuthContext, createTestQueryClient } from '@/test/test-utils'
import { render } from '@testing-library/react'
import { InvoicePage } from './InvoicePage'

const INVOICE = {
  invoiceNumber: 'INV-000001',
  issuedAt: '2026-02-02T00:00:00.000Z',
  currency: 'INR',
  orderId: 'order-1',
  orderNumber: 'PF-000042',
  orderPlacedAt: '2026-02-01T00:00:00.000Z',
  seller: {
    legalName: '',
    address: '',
    gstin: '',
    state: '',
    detailsPending: true,
  },
  buyer: {
    name: 'Jane Doe',
    phone: '9876543210',
    addressLine1: '1 Test Rd',
    addressLine2: null,
    city: 'Pune',
    state: 'MH',
    postalCode: '411001',
    country: 'India',
  },
  lines: [
    {
      description: 'Ceramic Mug',
      variantLabel: '11oz',
      unitPrice: '199.00',
      quantity: 1,
      lineTotal: '199.00',
    },
  ],
  subtotal: '199.00',
  discountAmount: '0.00',
  shippingFee: '0.00',
  taxableAmount: '199.00',
  taxAmount: '0.00',
  taxMode: 'INCLUSIVE',
  taxRatePercent: null,
  grandTotal: '199.00',
  notes: [
    'Seller legal name / address / GSTIN are pending — this document is not yet a valid tax invoice.',
    'No GST rate is configured. Tax is shown as ₹0.00 and is not itemised.',
    'HSN/SAC codes and the CGST/SGST/IGST breakdown are not included — pending client confirmation of the tax regime.',
  ],
}

function renderAt(role: 'CUSTOMER' | 'ADMIN' = 'CUSTOMER') {
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/orders/order-1/invoice']}>
        <AuthContext.Provider
          value={createMockAuthContext({
            status: 'authenticated',
            user: { id: 'u1', email: 'j@x.com', role, createdAt: '' },
          })}
        >
          <Routes>
            <Route path="/orders/:id/invoice" element={<InvoicePage />} />
          </Routes>
        </AuthContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('InvoicePage', () => {
  let mock: MockAdapter

  beforeEach(() => {
    mock = new MockAdapter(apiClient)
  })

  afterEach(() => {
    mock.restore()
    vi.restoreAllMocks()
  })

  it('renders server-authoritative invoice data with the pending notices', async () => {
    mock.onGet('/orders/order-1/invoice').reply(200, { success: true, data: INVOICE })

    renderAt('CUSTOMER')

    expect(await screen.findByText('INV-000001')).toBeInTheDocument()
    expect(screen.getByText(/Seller details pending/i)).toBeInTheDocument()
    expect(
      screen.getByText(/not yet a valid tax invoice/i),
    ).toBeInTheDocument()
    // No fabricated GST info: no GST line at all when the amount is 0.
    expect(screen.queryByText(/^GST/)).not.toBeInTheDocument()
    // Not titled "Tax invoice" without a rate.
    expect(
      screen.getByRole('heading', { level: 1, name: 'Invoice' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('article')).toHaveAttribute('data-invoice-sheet')
    expect(screen.getByRole('img', { name: 'AB Creations' })).toHaveAttribute(
      'src',
      '/brand/ab-creations/invoice-logo.jpg',
    )
  })

  it('offers a browser print action — never a fake file download', async () => {
    mock.onGet('/orders/order-1/invoice').reply(200, { success: true, data: INVOICE })
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {})

    renderAt('CUSTOMER')
    const btn = await screen.findByRole('button', { name: /print/i })
    btn.click()
    expect(printSpy).toHaveBeenCalledTimes(1)
    // There is no anchor pretending to download an invoice file.
    expect(
      screen.queryByRole('link', { name: /download/i }),
    ).not.toBeInTheDocument()
  })

  it('an admin reads the invoice via the admin endpoint', async () => {
    mock
      .onGet('/admin/orders/order-1/invoice')
      .reply(200, { success: true, data: { ...INVOICE, invoiceNumber: 'INV-000009' } })

    renderAt('ADMIN')
    expect(await screen.findByText('INV-000009')).toBeInTheDocument()
    // The customer endpoint is not used for an admin.
    expect(
      mock.history.get.some((r) => r.url === '/orders/order-1/invoice'),
    ).toBe(false)
  })

  it('surfaces a 409 (order not paid) as an error, no fabricated invoice', async () => {
    mock.onGet('/orders/order-1/invoice').reply(409, {
      success: false,
      error: {
        code: 'CONFLICT',
        message: 'An invoice is only available once the order has been paid',
        details: [],
      },
    })

    renderAt('CUSTOMER')
    // UX-46 shared ErrorState: the exact 409 message is surfaced assertively
    // under an "Invoice" heading — no fabricated invoice content.
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/only available once the order has been paid/i)
    expect(screen.getByRole('heading', { level: 1, name: 'Invoice' })).toBeInTheDocument()
  })
})
