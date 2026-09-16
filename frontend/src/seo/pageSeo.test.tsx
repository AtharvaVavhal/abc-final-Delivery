import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { waitFor } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { apiClient } from '@/services/api/client'
import { createMockAuthContext, renderWithProviders } from '@/test/test-utils'
import type { Category, Product } from '@/types/catalog'
import { HomePage } from '@/pages/home/HomePage'
import { ProductListPage } from '@/pages/catalog/ProductListPage'
import { ProductDetailPage } from '@/pages/catalog/ProductDetailPage'
import { CartPage } from '@/pages/cart/CartPage'
import { AboutPage } from '@/pages/static/AboutPage'
import { NotFoundPage } from '@/pages/not-found/NotFoundPage'
import { LoginPage } from '@/pages/auth/LoginPage'

function robots() {
  return document.head.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null
}
function canonical() {
  return document.head.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null
}
function ogContent(property: string) {
  return document.head.querySelector(`meta[property="${property}"]`)?.getAttribute('content') ?? null
}
function jsonLd(): Record<string, unknown>[] {
  return [...document.querySelectorAll('script[type="application/ld+json"]')].map(
    (el) => JSON.parse(el.textContent ?? 'null') as Record<string, unknown>,
  )
}

const CATEGORY: Category & { children: [] } = {
  id: 'cat-1',
  name: 'Mugs',
  slug: 'mugs',
  parentCategoryId: null,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  children: [],
}

const PRODUCT: Product = {
  id: 'p1',
  categoryId: 'cat-1',
  name: 'Ceramic Mug',
  slug: 'ceramic-mug',
  basePrice: '150.00',
  minQuantity: 1,
  maxQuantity: null,
  specifications: { Material: 'Ceramic' },
  isActive: true,
  avgRating: '4.50',
  reviewCount: 4,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  variants: [],
  images: [
    { id: 'i1', productId: 'p1', cloudinaryPublicId: 'x', resourceType: 'image', deliveryType: 'upload', url: 'https://cdn/mug.png', sortOrder: 0, isPrimary: true, createdAt: '' },
  ],
  customizationFields: [],
}

let mock: MockAdapter
let rootMock: MockAdapter

beforeEach(() => {
  mock = new MockAdapter(apiClient)
  rootMock = new MockAdapter(axios)
})
afterEach(() => {
  mock.restore()
  rootMock.restore()
})

describe('HomePage SEO', () => {
  it('has the home title, a self canonical, is indexable, and emits WebSite JSON-LD', async () => {
    mock.onGet('/settings').reply(200, { success: true, data: {} })
    mock.onGet('/categories').reply(200, { success: true, data: [] })
    mock.onGet('/products').reply(200, { success: true, data: [], meta: { page: 1, limit: 12, total: 0, totalPages: 1 } })

    renderWithProviders(<HomePage />)

    await waitFor(() => expect(document.title).toBe('AB Creations'))
    expect(robots()).toBe('index, follow')
    expect(canonical()).toBe('http://localhost:5173/')
    expect(jsonLd().some((b) => b['@type'] === 'WebSite')).toBe(true)
  })
})

describe('ProductListPage SEO', () => {
  function renderPLP(entry: string) {
    mock.onGet('/categories/tree').reply(200, { success: true, data: [CATEGORY] })
    mock.onGet('/products').reply(200, { success: true, data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1 } })
    return renderWithProviders(<ProductListPage />, { initialEntries: [entry] })
  }

  it('bare /products is indexable and canonicalises to itself', async () => {
    renderPLP('/products')
    await waitFor(() => expect(document.title).toBe('All products | AB Creations'))
    expect(robots()).toBe('index, follow')
    expect(canonical()).toBe('http://localhost:5173/products')
  })

  it('a category view uses the category name + a category canonical + Breadcrumb JSON-LD', async () => {
    renderPLP('/products?categoryId=cat-1')
    await waitFor(() => expect(document.title).toBe('Mugs | AB Creations'))
    expect(robots()).toBe('index, follow')
    expect(canonical()).toBe('http://localhost:5173/products?categoryId=cat-1')
    await waitFor(() =>
      expect(jsonLd().some((b) => b['@type'] === 'BreadcrumbList')).toBe(true),
    )
  })

  it('a filtered/sorted/paged/searched variant is noindex with no canonical or breadcrumb JSON-LD', async () => {
    renderPLP('/products?categoryId=cat-1&sort=price_asc&page=2&minPrice=100&search=mug')
    await waitFor(() => expect(robots()).toBe('noindex, nofollow'))
    expect(canonical()).toBeNull()
    expect(jsonLd().some((b) => b['@type'] === 'BreadcrumbList')).toBe(false)
  })
})

describe('ProductDetailPage SEO', () => {
  it('uses the product name, product canonical, product OG image, and Product + Breadcrumb JSON-LD', async () => {
    mock.onGet('/products/ceramic-mug').reply(200, { success: true, data: PRODUCT })
    mock.onGet('/products/p1/reviews').reply(200, { success: true, data: [], meta: { page: 1, limit: 10, total: 0, totalPages: 1 } })
    mock.onGet('/categories/tree').reply(200, { success: true, data: [] })

    renderWithProviders(
      <Routes>
        <Route path="/products/:slug" element={<ProductDetailPage />} />
      </Routes>,
      { initialEntries: ['/products/ceramic-mug'] },
    )

    await waitFor(() => expect(document.title).toBe('Ceramic Mug | AB Creations'))
    expect(canonical()).toBe('http://localhost:5173/products/ceramic-mug')
    expect(ogContent('og:type')).toBe('product')
    expect(ogContent('og:image')).toBe('https://cdn/mug.png')

    const blocks = jsonLd()
    const productLd = blocks.find((b) => b['@type'] === 'Product')
    expect(productLd).toMatchObject({
      name: 'Ceramic Mug',
      url: 'http://localhost:5173/products/ceramic-mug',
      offers: { price: '150.00', priceCurrency: 'INR', availability: 'https://schema.org/InStock' },
      aggregateRating: { ratingValue: '4.50', reviewCount: 4 },
    })
    expect(blocks.some((b) => b['@type'] === 'BreadcrumbList')).toBe(true)
  })

  it('a missing product renders a noindex "not found" head, never indexable content', async () => {
    mock.onGet('/products/ghost').reply(404, {
      success: false,
      error: { code: 'NOT_FOUND', message: 'Product not found', details: [] },
    })
    mock.onGet('/categories/tree').reply(200, { success: true, data: [] })

    renderWithProviders(
      <Routes>
        <Route path="/products/:slug" element={<ProductDetailPage />} />
      </Routes>,
      { initialEntries: ['/products/ghost'] },
    )

    await waitFor(() => expect(document.title).toBe('Product not found | AB Creations'))
    expect(robots()).toBe('noindex, nofollow')
    expect(jsonLd()).toHaveLength(0)
  })
})

describe('Private + static + 404 SEO', () => {
  it('the cart is noindex with no canonical', async () => {
    mock.onGet('/cart').reply(200, { success: true, data: { id: 'c1', items: [], itemCount: 0, subtotal: '0.00' } })
    renderWithProviders(<CartPage />, {
      authValue: createMockAuthContext({
        status: 'authenticated',
        user: { id: 'u1', email: 'x@y.z', role: 'CUSTOMER', createdAt: '2026-01-01T00:00:00.000Z' },
      }),
    })
    await waitFor(() => expect(document.title).toBe('Your cart | AB Creations'))
    expect(robots()).toBe('noindex, nofollow')
    expect(canonical()).toBeNull()
  })

  it('the About page is indexable with its own canonical', () => {
    renderWithProviders(<AboutPage />)
    expect(document.title).toBe('About | AB Creations')
    expect(robots()).toBe('index, follow')
    expect(canonical()).toBe('http://localhost:5173/about')
  })

  it('the 404 page is noindex and not presented as valid content', () => {
    renderWithProviders(<NotFoundPage />)
    expect(document.title).toBe('Page not found | AB Creations')
    expect(robots()).toBe('noindex, nofollow')
    expect(canonical()).toBeNull()
  })

  it('authentication pages are noindex (via AuthFormShell)', () => {
    renderWithProviders(<LoginPage />, { authValue: createMockAuthContext() })
    expect(document.title).toBe('Log in | AB Creations')
    expect(robots()).toBe('noindex, nofollow')
    expect(canonical()).toBeNull()
  })
})
