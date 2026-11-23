import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MockAdapter from 'axios-mock-adapter'
import { apiClient } from '@/services/api/client'
import { renderWithProviders } from '@/test/test-utils'
import type { OrderDetailView } from '@/types/orders'
import { OrderPhotoStatus } from './OrderPhotoStatus'

function order(status: string, photo: Record<string, unknown>): OrderDetailView {
  return {
    id: 'order-1',
    status,
    items: [
      {
        id: 'item-1',
        productName: 'Acrylic photo lamp',
        customizations: [
          { id: 'c-text', fieldLabel: 'Instructions', textValue: 'Plain background', uploadedFileId: null, reviewStatus: null, reviewNote: null },
          { id: 'c-photo', fieldLabel: 'Your photo', textValue: null, uploadedFileId: 'file-1', reviewStatus: 'PENDING', reviewNote: null, ...photo },
        ],
      },
    ],
  } as unknown as OrderDetailView
}

const png = () => new File([new Uint8Array([137, 80, 78, 71])], 'new.png', { type: 'image/png' })

describe('OrderPhotoStatus (customer)', () => {
  let mock: MockAdapter
  beforeEach(() => {
    mock = new MockAdapter(apiClient)
  })
  afterEach(() => mock.restore())

  it('says the photo is being reviewed', () => {
    renderWithProviders(<OrderPhotoStatus order={order('PAID', {})} />)
    expect(screen.getByText('We’re reviewing your photo')).toBeInTheDocument()
    expect(screen.queryByLabelText('Upload a new photo')).not.toBeInTheDocument()
  })

  it('says the photo is approved', () => {
    renderWithProviders(<OrderPhotoStatus order={order('CONFIRMED', { reviewStatus: 'APPROVED' })} />)
    expect(screen.getByText('Photo approved')).toBeInTheDocument()
  })

  it('shows the reason and an upload control when a new photo is needed', () => {
    renderWithProviders(
      <OrderPhotoStatus order={order('PAID', { reviewStatus: 'CHANGES_REQUESTED', reviewNote: 'Please upload a brighter photo' })} />,
    )
    expect(screen.getByText('We need a new photo')).toBeInTheDocument()
    expect(screen.getByText('Please upload a brighter photo')).toBeInTheDocument()
    expect(screen.getByLabelText('Upload a new photo')).toBeEnabled()
  })

  it('uploads the new photo, then attaches it to the order', async () => {
    const user = userEvent.setup()
    mock.onPost('/uploads').reply(200, { success: true, data: { id: 'file-9', url: 'x', format: 'png', bytes: 4, width: null, height: null, createdAt: 'now' } })
    mock.onPost('/orders/order-1/customizations/c-photo/replace-photo').reply(200, { success: true, data: { id: 'c-photo', reviewStatus: 'PENDING' } })
    renderWithProviders(<OrderPhotoStatus order={order('PAID', { reviewStatus: 'CHANGES_REQUESTED', reviewNote: 'Too dark' })} />)

    await user.upload(screen.getByLabelText('Upload a new photo'), png())

    await waitFor(() => expect(mock.history.post).toHaveLength(2))
    expect(mock.history.post[0].url).toBe('/uploads')
    expect(JSON.parse(String(mock.history.post[1].data))).toEqual({ uploadedFileId: 'file-9' })
  })

  it('rejects a non-image locally, without calling the server', async () => {
    const user = userEvent.setup({ applyAccept: false })
    renderWithProviders(<OrderPhotoStatus order={order('PAID', { reviewStatus: 'CHANGES_REQUESTED', reviewNote: 'x' })} />)

    await user.upload(screen.getByLabelText('Upload a new photo'), new File(['x'], 'a.pdf', { type: 'application/pdf' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/JPG, PNG or WebP/)
    expect(mock.history.post).toHaveLength(0)
  })

  it('shows the server message if the replacement is refused', async () => {
    const user = userEvent.setup()
    mock.onPost('/uploads').reply(200, { success: true, data: { id: 'file-9', url: 'x', format: 'png', bytes: 4, width: null, height: null, createdAt: 'now' } })
    mock.onPost('/orders/order-1/customizations/c-photo/replace-photo').reply(409, {
      success: false,
      error: { code: 'CONFLICT', message: 'The photo can no longer be changed for this order.', details: [] },
    })
    renderWithProviders(<OrderPhotoStatus order={order('PAID', { reviewStatus: 'CHANGES_REQUESTED', reviewNote: 'x' })} />)

    await user.upload(screen.getByLabelText('Upload a new photo'), png())

    expect(await screen.findByRole('alert')).toHaveTextContent(/can no longer be changed/)
  })

  it('offers no upload once production has started', () => {
    renderWithProviders(
      <OrderPhotoStatus order={order('IN_PRODUCTION', { reviewStatus: 'CHANGES_REQUESTED', reviewNote: 'x' })} />,
    )
    expect(screen.queryByLabelText('Upload a new photo')).not.toBeInTheDocument()
    expect(screen.getByText('This order can no longer be changed.')).toBeInTheDocument()
  })

  it('renders nothing when no photo is under review', () => {
    const o = order('PAID', {})
    o.items[0].customizations = o.items[0].customizations.filter((c) => c.uploadedFileId === null)
    const { container } = renderWithProviders(<OrderPhotoStatus order={o} />)
    expect(container).toBeEmptyDOMElement()
  })
})
