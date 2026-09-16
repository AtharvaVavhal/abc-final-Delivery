import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ProductImage as ProductImageData } from '@/types/catalog'
import { ProductImage } from './ProductImage'

function still(id: string, url: string, isPrimary = false): ProductImageData {
  return {
    id,
    productId: 'prod-1',
    cloudinaryPublicId: url,
    resourceType: 'image',
    deliveryType: 'upload',
    url,
    sortOrder: 0,
    isPrimary,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('ProductImage', () => {
  it('renders the primary still instead of the custom-print placeholder', () => {
    render(
      <ProductImage
        images={[still('img-1', '/catalog/identica/board.jpg', true)]}
        label="Office Signage Board"
      />,
    )

    const img = screen.getByRole('img', { name: 'Office Signage Board' })
    expect(img).toHaveAttribute('src', '/catalog/identica/board.jpg')
    expect(
      screen.queryByRole('img', { name: 'Office Signage Board — no image available' }),
    ).not.toBeInTheDocument()
  })

  it('tries the next still when the primary image fails to load', () => {
    render(
      <ProductImage
        images={[
          still('img-1', '/catalog/identica/missing.jpg', true),
          still('img-2', '/catalog/identica/board.jpg', false),
        ]}
        label="Office Signage Board"
      />,
    )

    fireEvent.error(screen.getByRole('img', { name: 'Office Signage Board' }))

    expect(screen.getByRole('img', { name: 'Office Signage Board' })).toHaveAttribute(
      'src',
      '/catalog/identica/board.jpg',
    )
  })
})
