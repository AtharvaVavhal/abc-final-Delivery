import { describe, expect, it } from 'vitest'
import type { Product } from '@/types/catalog'
import type { Crumb } from '@/components/ui/Breadcrumbs'
import { breadcrumbJsonLd, describeProduct, productJsonLd, websiteJsonLd } from './jsonLd'

function buildProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    categoryId: 'c1',
    name: 'Ceramic Mug',
    slug: 'ceramic-mug',
    basePrice: '150.00',
    minQuantity: 1,
    maxQuantity: null,
    specifications: null,
    isActive: true,
    avgRating: null,
    reviewCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    variants: [],
    images: [],
    customizationFields: [],
    ...overrides,
  }
}

describe('productJsonLd', () => {
  it('emits only real, server-provided fields', () => {
    const ld = productJsonLd(buildProduct(), '/products/ceramic-mug')

    expect(ld).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'Ceramic Mug',
      url: 'http://localhost:5173/products/ceramic-mug',
      offers: {
        '@type': 'Offer',
        price: '150.00',
        priceCurrency: 'INR',
        availability: 'https://schema.org/InStock',
        url: 'http://localhost:5173/products/ceramic-mug',
      },
    })
    // Nothing fabricated.
    expect(ld).not.toHaveProperty('brand')
    expect(ld).not.toHaveProperty('sku')
    expect(ld).not.toHaveProperty('gtin')
    expect(ld).not.toHaveProperty('aggregateRating')
    expect(ld).not.toHaveProperty('image')
  })

  it('includes images only when the product actually has them, primary first', () => {
    const ld = productJsonLd(
      buildProduct({
        images: [
          { id: 'a', productId: 'p1', cloudinaryPublicId: 'x', resourceType: 'image', deliveryType: 'upload', url: 'https://cdn/b.png', sortOrder: 1, isPrimary: false, createdAt: '' },
          { id: 'b', productId: 'p1', cloudinaryPublicId: 'y', resourceType: 'image', deliveryType: 'upload', url: 'https://cdn/a.png', sortOrder: 0, isPrimary: true, createdAt: '' },
        ],
      }),
      '/products/ceramic-mug',
    )
    expect(ld.image).toEqual(['https://cdn/a.png', 'https://cdn/b.png'])
  })

  it('includes aggregateRating only when there are real published reviews', () => {
    const withReviews = productJsonLd(
      buildProduct({ avgRating: '4.50', reviewCount: 8 }),
      '/products/ceramic-mug',
    )
    expect(withReviews.aggregateRating).toEqual({
      '@type': 'AggregateRating',
      ratingValue: '4.50',
      reviewCount: 8,
    })

    const noReviews = productJsonLd(buildProduct({ avgRating: null, reviewCount: 0 }), '/x')
    expect(noReviews).not.toHaveProperty('aggregateRating')
  })

  it('reports OutOfStock only when every variant is unavailable', () => {
    const out = productJsonLd(
      buildProduct({
        variants: [
          { id: 'v1', productId: 'p1', label: 'S', priceDelta: '0', isAvailable: false, createdAt: '', updatedAt: '' },
          { id: 'v2', productId: 'p1', label: 'M', priceDelta: '0', isAvailable: false, createdAt: '', updatedAt: '' },
        ],
      }),
      '/x',
    )
    expect((out.offers as Record<string, unknown>).availability).toBe('https://schema.org/OutOfStock')

    const partial = productJsonLd(
      buildProduct({
        variants: [
          { id: 'v1', productId: 'p1', label: 'S', priceDelta: '0', isAvailable: false, createdAt: '', updatedAt: '' },
          { id: 'v2', productId: 'p1', label: 'M', priceDelta: '0', isAvailable: true, createdAt: '', updatedAt: '' },
        ],
      }),
      '/x',
    )
    expect((partial.offers as Record<string, unknown>).availability).toBe('https://schema.org/InStock')
  })
})

describe('describeProduct', () => {
  it('returns null when there is nothing beyond the name', () => {
    expect(describeProduct(buildProduct({ specifications: null }))).toBeNull()
    expect(describeProduct(buildProduct({ specifications: {} }))).toBeNull()
  })

  it('builds a short factual line from primitive specification values only', () => {
    const desc = describeProduct(
      buildProduct({
        name: 'Ceramic Mug',
        specifications: { Material: 'Ceramic', Capacity: '11oz', Nested: { junk: true } },
      }),
    )
    expect(desc).toBe('Ceramic Mug. Material: Ceramic. Capacity: 11oz.')
  })

  it('skips Source and Listing provenance so JSON-LD uses real product specs', () => {
    const desc = describeProduct(
      buildProduct({
        name: 'Directional Signage Board',
        specifications: {
          Source: 'AB Creations listing on abcmanufactures.com',
          Listing:
            'https://www.abcmanufactures.com/products/identica-corporate-signage-directional-signage-board-1500-00-piece',
          Material: 'Acrylic',
          Shape: 'Rectangular',
        },
      }),
    )
    expect(desc).toBe('Directional Signage Board. Material: Acrylic. Shape: Rectangular.')
    expect(desc).not.toContain('mahakaladvertising')
    expect(desc).not.toContain('Listing')
  })
})

describe('breadcrumbJsonLd', () => {
  it('mirrors the visible crumb trail — last crumb carries no item', () => {
    const crumbs: Crumb[] = [
      { label: 'Home', to: '/' },
      { label: 'All products', to: '/products' },
      { label: 'Ceramic Mug' },
    ]
    const ld = breadcrumbJsonLd(crumbs)
    expect(ld).toEqual({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: 'http://localhost:5173/' },
        { '@type': 'ListItem', position: 2, name: 'All products', item: 'http://localhost:5173/products' },
        { '@type': 'ListItem', position: 3, name: 'Ceramic Mug' },
      ],
    })
  })

  it('returns null for a trivial (single-item) trail', () => {
    expect(breadcrumbJsonLd([{ label: 'Home', to: '/' }])).toBeNull()
  })
})

describe('websiteJsonLd', () => {
  it('is a plain WebSite entity with no invented SearchAction or Organization data', () => {
    const ld = websiteJsonLd()
    expect(ld).toEqual({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'AB Creations',
      url: 'http://localhost:5173/',
    })
  })
})
