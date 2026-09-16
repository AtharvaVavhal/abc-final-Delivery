import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { Route, Routes, useLocation } from 'react-router-dom'
import MockAdapter from 'axios-mock-adapter'
import { apiClient } from '@/services/api/client'
import { renderWithProviders } from '@/test/test-utils'
import { HeaderSearch } from './HeaderSearch'

const SAMPLE_PRODUCT = {
  id: 'prod-1',
  categoryId: 'cat-1',
  name: 'Ceramic Mug',
  slug: 'ceramic-mug',
  basePrice: '150',
  minQuantity: 1,
  maxQuantity: null,
  specifications: null,
  isActive: true,
  avgRating: null,
  reviewCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  variants: [],
  images: [
    {
      id: 'img-1',
      productId: 'prod-1',
      cloudinaryPublicId: 'mug',
      resourceType: 'image',
      deliveryType: 'upload',
      url: 'https://res.cloudinary.com/demo/image/upload/mug.png',
      sortOrder: 0,
      isPrimary: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  customizationFields: [],
}

function productsReply(items: unknown[]) {
  return {
    success: true,
    data: items,
    meta: { page: 1, limit: 6, total: items.length, totalPages: 1 },
  }
}

function LocationProbe() {
  const location = useLocation()
  return (
    <div data-testid="loc">
      {location.pathname}
      {location.search}
    </div>
  )
}

describe('HeaderSearch suggestions', () => {
  let mock: MockAdapter

  beforeEach(() => {
    mock = new MockAdapter(apiClient)
  })

  afterEach(() => {
    mock.restore()
  })

  it('does not fetch or list products while the field is empty', () => {
    mock.onGet('/products').reply(200, productsReply([SAMPLE_PRODUCT]))
    renderWithProviders(<HeaderSearch variant="bar" active />)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(mock.history.get).toHaveLength(0)
  })

  it('lists matching products under the field after typing', async () => {
    mock.onGet('/products').reply((config) => {
      expect(config.params).toMatchObject({ search: 'mug', limit: 6, sort: 'newest' })
      return [200, productsReply([SAMPLE_PRODUCT])]
    })
    renderWithProviders(<HeaderSearch variant="bar" active />)

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'mug' } })

    expect(await screen.findByRole('option', { name: /Ceramic Mug/ })).toHaveAttribute(
      'href',
      '/products/ceramic-mug',
    )
    expect(screen.getByText('₹150.00')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /See all results for “mug”/ })).toHaveAttribute(
      'href',
      '/products?search=mug',
    )
  })

  it('opens the product page from a suggestion', async () => {
    mock.onGet('/products').reply(200, productsReply([SAMPLE_PRODUCT]))
    renderWithProviders(
      <>
        <HeaderSearch variant="bar" active />
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </>,
    )

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'mug' } })
    fireEvent.click(await screen.findByRole('option', { name: /Ceramic Mug/ }))

    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/products/ceramic-mug'))
  })

  it('shows an empty message when nothing matches', async () => {
    mock.onGet('/products').reply(200, productsReply([]))
    renderWithProviders(<HeaderSearch variant="bar" active />)

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzzznope' } })

    expect(await screen.findByText('No products match “zzzznope”')).toBeInTheDocument()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
