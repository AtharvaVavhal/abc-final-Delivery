import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MockAdapter from 'axios-mock-adapter'
import { apiClient } from '@/services/api/client'
import { renderWithProviders } from '@/test/test-utils'
import type { OrderDetailView } from '@/types/orders'
import { PhotoReviewPanel } from './PhotoReviewPanel'

const FILE = {
  id: 'file-1',
  url: 'https://img.test/photo.jpg',
  format: 'jpg',
  bytes: 3355443,
  width: 3024,
  height: 4032,
  createdAt: '2026-11-23T10:00:00.000Z',
}

function order(overrides: Record<string, unknown> = {}, photo: Record<string, unknown> = {}): OrderDetailView {
  return {
    id: 'order-1',
    status: 'PAID',
    items: [
      {
        id: 'item-1',
        productId: 'p1',
        productName: 'Acrylic photo lamp',
        variantLabel: null,
        unitPrice: '1499.00',
        quantity: 1,
        lineTotal: '1499.00',
        customizations: [
          { id: 'c-text', fieldLabel: 'Instructions', textValue: 'Keep the background plain', uploadedFileId: null, reviewStatus: null, reviewNote: null },
          { id: 'c-photo', fieldLabel: 'Your photo', textValue: null, uploadedFileId: 'file-1', reviewStatus: 'PENDING', reviewNote: null, ...photo },
        ],
      },
    ],
    ...overrides,
  } as unknown as OrderDetailView
}

describe('PhotoReviewPanel', () => {
  let mock: MockAdapter
  beforeEach(() => {
    mock = new MockAdapter(apiClient)
    mock.onGet('/uploads/file-1').reply(200, { success: true, data: FILE })
  })
  afterEach(() => mock.restore())

  it('shows the photo, the facts about it, the customer instructions and its state', async () => {
    renderWithProviders(<PhotoReviewPanel order={order()} />)

    const img = await screen.findByRole('img', { name: /Customer photo for Acrylic photo lamp/ })
    expect(img).toHaveAttribute('src', FILE.url)
    expect(screen.getByText('JPG')).toBeInTheDocument()
    expect(screen.getByText('3.2 MB')).toBeInTheDocument()
    expect(screen.getByText('3024 × 4032 px')).toBeInTheDocument()
    expect(screen.getByText('Keep the background plain')).toBeInTheDocument()
    expect(screen.getByText('To review')).toBeInTheDocument()
  })

  it('says "Not recorded" for the resolution of an older file', async () => {
    mock.onGet('/uploads/file-1').reply(200, { success: true, data: { ...FILE, width: null, height: null } })
    renderWithProviders(<PhotoReviewPanel order={order()} />)
    expect(await screen.findByText('Not recorded')).toBeInTheDocument()
  })

  it('approves for production', async () => {
    const user = userEvent.setup()
    mock.onPatch('/admin/orders/order-1/customizations/c-photo/review').reply(200, {
      success: true,
      data: { id: 'c-photo', reviewStatus: 'APPROVED', reviewNote: null, reviewedAt: '2026-11-23T10:05:00.000Z' },
    })
    renderWithProviders(<PhotoReviewPanel order={order()} />)

    await user.click(await screen.findByRole('button', { name: 'Approve for production' }))

    await waitFor(() => expect(mock.history.patch).toHaveLength(1))
    expect(JSON.parse(mock.history.patch[0].data)).toEqual({ decision: 'APPROVE' })
  })

  it('needs a note (at least 3 characters) before asking for a new photo, then sends it', async () => {
    const user = userEvent.setup()
    mock.onPatch('/admin/orders/order-1/customizations/c-photo/review').reply(200, {
      success: true,
      data: { id: 'c-photo', reviewStatus: 'CHANGES_REQUESTED', reviewNote: 'Too dark', reviewedAt: '2026-11-23T10:05:00.000Z' },
    })
    renderWithProviders(<PhotoReviewPanel order={order()} />)

    await user.click(await screen.findByRole('button', { name: 'Ask for a new photo' }))
    const send = screen.getByRole('button', { name: 'Send request' })
    expect(send).toBeDisabled()

    await user.type(screen.getByLabelText('What should the customer fix?'), 'ab')
    expect(send).toBeDisabled()
    await user.type(screen.getByLabelText('What should the customer fix?'), 'c dark')
    expect(send).toBeEnabled()
    await user.click(send)

    await waitFor(() => expect(mock.history.patch).toHaveLength(1))
    expect(JSON.parse(mock.history.patch[0].data)).toEqual({
      decision: 'REQUEST_CHANGES',
      note: 'abc dark',
    })
  })

  it('shows the server message when a decision is refused', async () => {
    const user = userEvent.setup()
    mock.onPatch('/admin/orders/order-1/customizations/c-photo/review').reply(409, {
      success: false,
      error: { code: 'CONFLICT', message: 'Photos can only be reviewed while the order is paid and not yet in production.', details: [] },
    })
    renderWithProviders(<PhotoReviewPanel order={order()} />)

    await user.click(await screen.findByRole('button', { name: 'Approve for production' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/only be reviewed while the order is paid/)
  })

  it('offers no decisions once production has started, and says why', async () => {
    renderWithProviders(<PhotoReviewPanel order={order({ status: 'IN_PRODUCTION' }, { reviewStatus: 'APPROVED' })} />)

    await screen.findByRole('img', { name: /Customer photo/ })
    expect(screen.queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ask for a new photo' })).not.toBeInTheDocument()
    expect(screen.getByText(/paid and not yet in production/)).toBeInTheDocument()
  })

  it('shows the note when a new photo was already requested', async () => {
    renderWithProviders(
      <PhotoReviewPanel order={order({}, { reviewStatus: 'CHANGES_REQUESTED', reviewNote: 'Please crop closer' })} />,
    )
    const note = await screen.findByText(/Please crop closer/)
    expect(within(note.closest('p')!).getByText(/You asked for a new photo/)).toBeInTheDocument()
    expect(screen.getByText('New photo needed')).toBeInTheDocument()
  })

  it('renders nothing for an order without photos', () => {
    const noPhoto = order()
    noPhoto.items[0].customizations = noPhoto.items[0].customizations.filter((c) => c.uploadedFileId === null)
    const { container } = renderWithProviders(<PhotoReviewPanel order={noPhoto} />)
    expect(container).toBeEmptyDOMElement()
  })
})
