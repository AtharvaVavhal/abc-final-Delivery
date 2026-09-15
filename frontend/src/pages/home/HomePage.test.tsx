import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import type { AxiosRequestConfig } from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { apiClient } from '@/services/api/client'
import { renderWithProviders } from '@/test/test-utils'
import type { Category, Product } from '@/types/catalog'
import { HomePage } from './HomePage'

let mock: MockAdapter

function category(overrides: Partial<Category> = {}): Category {
  return {
    id: 'cat-mugs',
    name: 'Mugs',
    slug: 'mugs',
    parentCategoryId: null,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'prod-1',
    categoryId: 'cat-mugs',
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
    images: [],
    customizationFields: [],
    ...overrides,
  }
}

const NEW_ARRIVALS = [
  product({ id: 'p-new-1', name: 'Matte Poster', slug: 'matte-poster' }),
  product({ id: 'p-new-2', name: 'Enamel Pin', slug: 'enamel-pin' }),
]
const TOP_RATED = [
  product({
    id: 'p-top-1',
    name: 'Signature Hoodie',
    slug: 'signature-hoodie',
    avgRating: '4.80',
    reviewCount: 12,
  }),
]

function ok<T>(data: T, meta?: unknown): [number, unknown] {
  return [200, { success: true, data, ...(meta ? { meta } : {}) }]
}

interface HomeMockOptions {
  settings?: Record<string, unknown>
  categories?: Category[]
  newArrivals?: Product[]
  topRated?: Product[]
}

function mockHome({
  settings = {},
  categories = [category()],
  newArrivals = NEW_ARRIVALS,
  topRated = TOP_RATED,
  storeName = 'PrintForge',
}: HomeMockOptions & { storeName?: string } = {}) {
  // Real GET /settings?keys=… wire shape: the settings map is nested at
  // data.data and every value is a JSON string.
  const settingsMap = Object.fromEntries(
    Object.entries(settings).map(([key, value]) => [
      key,
      typeof value === 'string' ? value : JSON.stringify(value),
    ]),
  )
  mock.onGet('/settings').reply(200, { success: true, data: { data: settingsMap } })
  mock.onGet('/settings/storeName').reply(200, { success: true, data: { value: storeName } })
  mock.onGet('/categories').reply(...ok(categories))
  mock.onGet('/products').reply((config: AxiosRequestConfig) => {
    const params = (config.params ?? {}) as Record<string, unknown>
    const items = params.minRating ? topRated : newArrivals
    return ok(items, { page: 1, limit: 12, total: items.length, totalPages: 1 })
  })
}

beforeEach(() => {
  mock = new MockAdapter(apiClient)
})

afterEach(() => {
  mock.restore()
})

describe('HomePage — storefront layout', () => {
  it('shows a neutral catalogue hero when no promo is configured (no invented claims)', async () => {
    mockHome()
    renderWithProviders(<HomePage />)

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /custom prints, made to order/i,
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /browse the catalogue/i }),
    ).toHaveAttribute('href', '/products')
  })

  it('announces the hero loading state politely while homepage settings are in flight', async () => {
    mock.onGet('/settings').reply(() => new Promise(() => {})) // never settles
    mock.onGet('/settings/storeName').reply(200, { success: true, data: { value: 'PrintForge' } })
    mock.onGet('/categories').reply(...ok([category()]))
    mock.onGet('/products').reply(...ok(NEW_ARRIVALS, { page: 1, limit: 12, total: 2, totalPages: 1 }))
    renderWithProviders(<HomePage />)

    const label = await screen.findByText('Loading homepage')
    expect(label.closest('[role="status"]')).toBeInTheDocument()
  })

  it('renders the configured store name as the hero eyebrow', async () => {
    mockHome({ storeName: 'Atharva Prints' })
    renderWithProviders(<HomePage />)

    const heading = await screen.findByRole('heading', {
      level: 1,
      name: /custom prints, made to order/i,
    })
    // The eyebrow sits just above the hero headline.
    expect(heading.previousElementSibling).toHaveTextContent('Atharva Prints')
  })

  it('falls back to "PrintForge" for the hero eyebrow when the store-name endpoint fails', async () => {
    mock.onGet('/settings/storeName').reply(500)
    mock.onGet('/settings').reply(200, { success: true, data: { data: {} } })
    mock.onGet('/categories').reply(...ok([category()]))
    mock.onGet('/products').reply(...ok(NEW_ARRIVALS, { page: 1, limit: 12, total: 0, totalPages: 1 }))
    renderWithProviders(<HomePage />)

    const heading = await screen.findByRole('heading', {
      level: 1,
      name: /custom prints, made to order/i,
    })
    expect(heading.previousElementSibling).toHaveTextContent('PrintForge')
  })

  it('does not render the redundant "Shop by category" rail on the homepage', () => {
    mockHome({
      categories: [
        category({ id: 'c1', name: 'Mugs' }),
        category({ id: 'c2', name: 'Apparel' }),
      ],
    })
    renderWithProviders(<HomePage />)

    expect(screen.queryByRole('region', { name: /shop by category/i })).not.toBeInTheDocument()
  })

  it('renders product discovery rails from GET /products', async () => {
    mockHome()
    renderWithProviders(<HomePage />)

    expect(
      await screen.findByRole('heading', { level: 3, name: 'Matte Poster' }),
    ).toBeInTheDocument()
    expect(
      await screen.findByRole('heading', { level: 3, name: 'Signature Hoodie' }),
    ).toBeInTheDocument()

    const newArrivals = screen.getByRole('region', { name: /new arrivals/i })
    expect(within(newArrivals).getByRole('link', { name: /view all/i })).toHaveAttribute(
      'href',
      '/products?sort=newest',
    )
  })

  it('hides the "Top rated" rail when the rating query returns nothing', async () => {
    mockHome({ topRated: [] })
    renderWithProviders(<HomePage />)

    await screen.findByRole('heading', { level: 3, name: 'Matte Poster' })
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: /top rated/i })).not.toBeInTheDocument()
    })
  })

  it('still renders the page when the catalogue APIs fail — rails just drop out', async () => {
    mock.onGet('/settings').reply(200, { success: true, data: { data: {} } })
    mock.onGet('/categories').reply(500)
    mock.onGet('/products').reply(500)
    renderWithProviders(<HomePage />)

    expect(
      await screen.findByRole('heading', { level: 1, name: /custom prints, made to order/i }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /shop by category/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /new arrivals/i })).not.toBeInTheDocument()
  })
})

describe('HomePage — heading hierarchy (UX-14)', () => {
  it('has exactly one <h1> (the neutral hero) when no promo is configured', async () => {
    mockHome()
    renderWithProviders(<HomePage />)

    await screen.findByRole('heading', { level: 1, name: /custom prints, made to order/i })
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('keeps exactly one <h1> when a multi-slide hero carousel is configured', async () => {
    mockHome({
      settings: {
        hero_slides: [
          { imageUrl: '', headline: 'Summer drop', subtext: 'a', ctaText: 'Shop', ctaLink: '/products' },
          { imageUrl: '', headline: 'Winter drop', subtext: 'b', ctaText: 'Shop', ctaLink: '/products' },
          { imageUrl: '', headline: 'Spring drop', subtext: 'c', ctaText: 'Shop', ctaLink: '/products' },
        ],
      },
    })
    renderWithProviders(<HomePage />)

    // The active slide's headline is the sole <h1>; the other slides render
    // their headline as a (hidden) <p>, not a competing heading.
    const h1s = await screen.findAllByRole('heading', { level: 1 })
    expect(h1s).toHaveLength(1)
    expect(h1s[0]).toHaveTextContent('Summer drop')
  })

  it('renders configured promo-banner titles as <h2>, not <h3> (no level skip under the hero <h1>)', async () => {
    mockHome({
      settings: {
        banners: [{ imageUrl: '', title: 'Sitewide sale', text: 'Up to 20% off', link: '/products' }],
      },
    })
    renderWithProviders(<HomePage />)

    expect(await screen.findByRole('heading', { level: 2, name: 'Sitewide sale' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 3, name: 'Sitewide sale' })).not.toBeInTheDocument()
  })
})

describe('HomePage — configured promo content (data layer)', () => {
  it('mounts the hero carousel from JSON-string hero_slides and hides the neutral hero', async () => {
    mockHome({
      settings: {
        hero_slides: [
          { imageUrl: '', headline: 'Summer drop', subtext: 'a', ctaText: 'Shop', ctaLink: '/products' },
          { imageUrl: '', headline: 'Winter drop', subtext: 'b', ctaText: 'Shop', ctaLink: '/products' },
        ],
      },
    })
    renderWithProviders(<HomePage />)

    expect(await screen.findByRole('region', { name: /hero carousel/i })).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { level: 1, name: /custom prints, made to order/i }),
    ).not.toBeInTheDocument()
  })

  it('renders the promo banner grid from JSON-string banners', async () => {
    mockHome({
      settings: {
        banners: [{ imageUrl: '', title: 'Sitewide sale', text: 'Up to 20% off', link: '/products' }],
      },
    })
    renderWithProviders(<HomePage />)

    const grid = await screen.findByRole('region', { name: /promotional banners/i })
    expect(within(grid).getByRole('heading', { level: 2, name: 'Sitewide sale' })).toBeInTheDocument()
  })

  it('renders the curated category showcase from JSON-string showcase_categories, replacing the live rail', async () => {
    mockHome({
      settings: {
        showcase_categories: [
          { categoryId: 'c1', imageUrl: '', title: 'Mugs' },
          { categoryId: 'c2', imageUrl: '', title: 'Apparel' },
        ],
      },
      // A live category the CategoryRail would show if it were the one rendered.
      categories: [category({ id: 'live-cat', name: 'Live Rail Category' })],
    })
    renderWithProviders(<HomePage />)

    // "Shop <title>" links only exist in the curated CategoryShowcase.
    const curatedLink = await screen.findByRole('link', { name: 'Shop Mugs' })
    expect(curatedLink).toHaveAttribute('href', '/products?categoryId=c1')
    expect(screen.getByRole('link', { name: 'Shop Apparel' })).toHaveAttribute(
      'href',
      '/products?categoryId=c2',
    )
    // The live rail is not rendered when a showcase is configured.
    expect(screen.queryByRole('link', { name: 'Live Rail Category' })).not.toBeInTheDocument()
  })

  it('ignores a malformed hero_slides value and falls back to the neutral hero', async () => {
    mockHome({ settings: { hero_slides: '[{"headline":"broken"' } })
    renderWithProviders(<HomePage />)

    expect(
      await screen.findByRole('heading', { level: 1, name: /custom prints, made to order/i }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /hero carousel/i })).not.toBeInTheDocument()
  })
})

describe('HomePage — content integrity', () => {
  it('does not present fabricated testimonials as real customer feedback', async () => {
    mockHome()
    renderWithProviders(<HomePage />)
    await screen.findByRole('heading', { level: 1, name: /custom prints, made to order/i })

    expect(screen.queryByText(/what our customers say/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/verified printforge customers/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/priya s\.?/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/rahul m\.?/i)).not.toBeInTheDocument()
  })

  it('does not show a fake newsletter subscription', async () => {
    mockHome()
    renderWithProviders(<HomePage />)
    await screen.findByRole('heading', { level: 1, name: /custom prints, made to order/i })

    expect(screen.queryByRole('button', { name: /subscribe/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/stay updated/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/you agree to receive marketing emails/i)).not.toBeInTheDocument()
  })

  it('does not invent delivery, discount, or tax promises in the value section', async () => {
    mockHome()
    renderWithProviders(<HomePage />)
    const trust = await screen.findByRole('region', { name: /why shop with printforge/i })

    expect(within(trust).queryByText(/free (delivery|shipping)/i)).not.toBeInTheDocument()
    expect(within(trust).queryByText(/\d+% off/i)).not.toBeInTheDocument()
    expect(within(trust).queryByText(/money-back|easy returns|gst/i)).not.toBeInTheDocument()
  })
})
