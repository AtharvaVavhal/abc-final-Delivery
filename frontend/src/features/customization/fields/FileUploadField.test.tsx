import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MockAdapter from 'axios-mock-adapter'
import { apiClient } from '@/services/api/client'
import { renderWithProviders } from '@/test/test-utils'
import type { CustomizationField } from '@/types/catalog'
import { FileUploadField } from './FileUploadField'

function buildField(overrides: Partial<CustomizationField>): CustomizationField {
  return {
    id: 'logo',
    productId: 'prod-1',
    label: 'Logo',
    type: 'LOGO_UPLOAD',
    isRequired: true,
    sortOrder: 0,
    helpText: null,
    constraints: { allowedFormats: ['png', 'jpeg'], maxFileSizeMb: 5 },
    surchargeType: 'NONE',
    surchargeAmount: '0',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const DESIGN_FIELD = buildField({
  id: 'design',
  label: 'Design file',
  type: 'DESIGN_FILE_UPLOAD',
  constraints: { allowedFormats: ['pdf'], maxFileSizeMb: 10 },
})

/** Wires value ↔ onChange so the component sees the id it reports back,
 * exactly like CustomizationForm's <Controller> does. */
function Harness({
  field,
  onChange,
}: {
  field: CustomizationField
  onChange?: (id: string) => void
}) {
  const [value, setValue] = useState('')
  return (
    <FileUploadField
      field={field}
      value={value}
      onChange={(id) => {
        setValue(id)
        onChange?.(id)
      }}
    />
  )
}

const UPLOAD_RESPONSE = {
  success: true,
  data: {
    id: 'uploaded-file-id-1',
    url: 'https://res.cloudinary.com/demo/image/upload/logo.png',
    format: 'png',
    bytes: 2048,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
}

describe('FileUploadField (UX-22 selected-file preview)', () => {
  let apiMock: MockAdapter

  beforeEach(() => {
    apiMock = new MockAdapter(apiClient)
  })

  afterEach(() => {
    apiMock.restore()
    vi.restoreAllMocks()
  })

  it('shows a styled upload button and no selected-file card before anything is picked', () => {
    renderWithProviders(<Harness field={buildField({})} />)

    expect(screen.getByRole('button', { name: 'Upload logo' })).toBeVisible()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
  })

  it('shows a selected-file card with filename + type/size immediately on selection, while the upload is still in flight', async () => {
    const user = userEvent.setup()
    apiMock
      .onPost('/uploads')
      .reply(() => new Promise((resolve) => setTimeout(() => resolve([201, UPLOAD_RESPONSE]), 40)))
    renderWithProviders(<Harness field={buildField({})} />)

    const file = new File(['img-bytes'], 'brand-logo.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('Logo *', { selector: 'input' }), file)

    expect(await screen.findByText('brand-logo.png')).toBeInTheDocument()
    expect(screen.getByText(/PNG ·/)).toBeInTheDocument() // type + size metadata
    const status = screen.getByText('brand-logo.png').closest('div')!.querySelector('[role="status"]')!
    expect(status).toHaveTextContent('Uploading…')

    await waitFor(() => expect(status).toHaveTextContent('Uploaded'))
  })

  it('renders a local data-URL thumbnail for an image file (safe preview)', async () => {
    const user = userEvent.setup()
    apiMock.onPost('/uploads').reply(201, UPLOAD_RESPONSE)
    renderWithProviders(<Harness field={buildField({})} />)

    await user.upload(
      screen.getByLabelText('Logo *', { selector: 'input' }),
      new File(['PNGDATA'], 'thumb.png', { type: 'image/png' }),
    )

    const img = await screen.findByRole('img', { name: 'Preview of thumb.png' })
    await waitFor(() => expect(img).toHaveAttribute('src', expect.stringMatching(/^data:image\/png/)))
  })

  it('shows an extension badge (no <img>) + filename + size for a non-previewable file', async () => {
    const user = userEvent.setup()
    apiMock
      .onPost('/uploads')
      .reply(201, { ...UPLOAD_RESPONSE, data: { ...UPLOAD_RESPONSE.data, format: 'pdf' } })
    renderWithProviders(<Harness field={DESIGN_FIELD} />)

    const pdf = new File([new Uint8Array(3000)], 'artwork.pdf', { type: 'application/pdf' })
    await user.upload(screen.getByLabelText('Design file *', { selector: 'input' }), pdf)

    expect(await screen.findByText('artwork.pdf')).toBeInTheDocument()
    expect(screen.getByText(/PDF · 3 KB/)).toBeInTheDocument()
    // Never a thumbnail for a non-image file — even after the upload resolves.
    await waitFor(() =>
      expect(screen.getByText('artwork.pdf').closest('div')!.querySelector('[role="status"]')).toHaveTextContent('Uploaded'),
    )
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('keeps the existing validation error for an oversized file and shows no selected-file card', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness field={buildField({})} />)

    const huge = new File([new Uint8Array(6 * 1024 * 1024)], 'huge.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('Logo *', { selector: 'input' }), huge)

    expect(await screen.findByText('Logo must be at most 5MB')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    expect(apiMock.history.post).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Upload logo' })).toBeVisible()
  })

  it('Remove clears the card, restores the upload button and resets the value', async () => {
    const user = userEvent.setup()
    apiMock.onPost('/uploads').reply(201, UPLOAD_RESPONSE)
    const onChange = vi.fn()
    renderWithProviders(<Harness field={buildField({})} onChange={onChange} />)

    await user.upload(
      screen.getByLabelText('Logo *', { selector: 'input' }),
      new File(['x'], 'logo.png', { type: 'image/png' }),
    )
    await screen.findByText('logo.png')
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('uploaded-file-id-1'))

    await user.click(screen.getByRole('button', { name: 'Remove' }))

    expect(screen.queryByText('logo.png')).not.toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload logo' })).toBeVisible()
    expect(onChange).toHaveBeenLastCalledWith('')
  })

  it('swaps the preview when a different file is picked via Change', async () => {
    const user = userEvent.setup()
    apiMock.onPost('/uploads').reply(201, UPLOAD_RESPONSE)
    renderWithProviders(<Harness field={buildField({})} />)

    const input = screen.getByLabelText('Logo *', { selector: 'input' })
    await user.upload(input, new File(['a'], 'first.png', { type: 'image/png' }))
    expect(await screen.findByText('first.png')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Change' }))
    await user.upload(input, new File(['b'], 'second.png', { type: 'image/png' }))

    expect(await screen.findByText('second.png')).toBeInTheDocument()
    expect(screen.queryByText('first.png')).not.toBeInTheDocument()
  })

  it('tears down cleanly on unmount while a preview is showing (no error)', async () => {
    const user = userEvent.setup()
    apiMock.onPost('/uploads').reply(201, UPLOAD_RESPONSE)
    const { unmount } = renderWithProviders(<Harness field={buildField({})} />)

    await user.upload(
      screen.getByLabelText('Logo *', { selector: 'input' }),
      new File(['x'], 'keep.png', { type: 'image/png' }),
    )
    await screen.findByText('keep.png')

    expect(() => unmount()).not.toThrow()
  })

  it('still reports the uploadedFileId to onChange on a successful upload (submission behaviour unchanged)', async () => {
    const user = userEvent.setup()
    apiMock.onPost('/uploads').reply(201, UPLOAD_RESPONSE)
    const onChange = vi.fn()
    renderWithProviders(<Harness field={buildField({})} onChange={onChange} />)

    await user.upload(
      screen.getByLabelText('Logo *', { selector: 'input' }),
      new File(['x'], 'logo.png', { type: 'image/png' }),
    )

    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('uploaded-file-id-1'))
    expect(apiMock.history.post).toHaveLength(1)
    expect(apiMock.history.post[0].url).toBe('/uploads')
  })

  it('opens the picker from the styled button', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness field={buildField({})} />)

    const input = screen.getByLabelText('Logo *', { selector: 'input' })
    const click = vi.spyOn(input, 'click')
    await user.click(screen.getByRole('button', { name: 'Upload logo' }))
    expect(click).toHaveBeenCalled()
  })

  it('keeps Change / Remove operable by keyboard', async () => {
    const user = userEvent.setup()
    apiMock.onPost('/uploads').reply(201, UPLOAD_RESPONSE)
    renderWithProviders(<Harness field={buildField({})} />)

    await user.upload(
      screen.getByLabelText('Logo *', { selector: 'input' }),
      new File(['x'], 'logo.png', { type: 'image/png' }),
    )
    await screen.findByText('logo.png')
    const remove = screen.getByRole('button', { name: 'Remove' })
    const change = screen.getByRole('button', { name: 'Change' })
    change.focus()
    expect(change).toHaveFocus()

    remove.focus()
    expect(remove).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.queryByText('logo.png')).not.toBeInTheDocument()
  })
})
