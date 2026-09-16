import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MockAdapter from 'axios-mock-adapter'
import { apiClient } from '@/services/api/client'
import { renderWithProviders } from '@/test/test-utils'
import { RATING_OPTIONS } from '@/types/catalog'
import { ProductListPage } from './ProductListPage'

const CATEGORY_TREE_RESPONSE = {
  success: true,
  data: [
    {
      id: 'cat-1',
      name: 'Mugs',
      slug: 'mugs',
      children: [
        { id: 'cat-2', name: 'Tumblers', slug: 'tumblers', children: [] },
      ],
    },
  ],
}

function productsResponse(items: unknown[]) {
  return {
    success: true,
    data: items,
    meta: { page: 1, limit: 20, total: items.length, totalPages: Math.max(1, items.length) },
  }
}

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
  images: [],
  customizationFields: [],
}

describe('ProductListPage', () => {
  let mock: MockAdapter

  beforeEach(() => {
    mock = new MockAdapter(apiClient)
  })

  afterEach(() => {
    mock.restore()
  })

  it('renders products returned by the API', async () => {
    mock.onGet('/categories/tree').reply(200, CATEGORY_TREE_RESPONSE)
    mock.onGet('/products').reply(200, productsResponse([SAMPLE_PRODUCT]))

    renderWithProviders(<ProductListPage />)

    expect(await screen.findByText('Ceramic Mug')).toBeInTheDocument()
    expect(screen.getByText('₹150.00')).toBeInTheDocument()
  })

  it('has one page <h1> and renders product names as <h2> (UX-14 — no h1→h3 skip)', async () => {
    mock.onGet('/categories/tree').reply(200, CATEGORY_TREE_RESPONSE)
    mock.onGet('/products').reply(
      200,
      productsResponse([
        SAMPLE_PRODUCT,
        { ...SAMPLE_PRODUCT, id: 'prod-2', name: 'Enamel Mug', slug: 'enamel-mug' },
      ]),
    )

    renderWithProviders(<ProductListPage />)

    await screen.findByText('Ceramic Mug')
    const h1s = screen.getAllByRole('heading', { level: 1 })
    expect(h1s).toHaveLength(1)
    expect(h1s[0]).toHaveTextContent('All products')
    expect(screen.getByRole('heading', { level: 2, name: 'Ceramic Mug' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Enamel Mug' })).toBeInTheDocument()
  })

  it('renders the empty-catalog state when there are zero products', async () => {
    mock.onGet('/categories/tree').reply(200, CATEGORY_TREE_RESPONSE)
    mock.onGet('/products').reply(200, productsResponse([]))

    renderWithProviders(<ProductListPage />)

    expect(await screen.findByText('No products yet')).toBeInTheDocument()
  })

  it('renders an error state when the products request fails', async () => {
    mock.onGet('/categories/tree').reply(200, CATEGORY_TREE_RESPONSE)
    mock.onGet('/products').reply(500, {
      success: false,
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Something broke', details: [] },
    })

    renderWithProviders(<ProductListPage />)

    expect(await screen.findByText('Something broke')).toBeInTheDocument()
  })

  it('forwards URL filters to the product list request', async () => {
    mock.onGet('/categories/tree').reply(200, CATEGORY_TREE_RESPONSE)
    mock.onGet('/products').reply(200, productsResponse([SAMPLE_PRODUCT]))

    renderWithProviders(<ProductListPage />, {
      initialEntries: [
        '/products?categoryId=cat-1&search=mug&page=3&minPrice=100&maxPrice=500&minRating=4&sort=price_asc',
      ],
    })

    expect(await screen.findByText('Ceramic Mug')).toBeInTheDocument()

    const productsCall = mock.history.get.find((request) => {
      const params = request.params as { limit?: number } | undefined
      return request.url === '/products' && Number(params?.limit) === 20
    })
    expect(productsCall?.params).toMatchObject({
      categoryId: 'cat-1',
      search: 'mug',
      page: 3,
      limit: 20,
      minPrice: 100,
      maxPrice: 500,
      minRating: 4,
      sort: 'price_asc',
    })
  })

  it('uses the category name as the page title and breadcrumb when a category is active', async () => {
    mock.onGet('/categories/tree').reply(200, CATEGORY_TREE_RESPONSE)
    mock.onGet('/products').reply(200, productsResponse([SAMPLE_PRODUCT]))

    renderWithProviders(<ProductListPage />, {
      initialEntries: ['/products?categoryId=cat-2'],
    })

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Tumblers' }),
    ).toBeInTheDocument()
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(crumbs).getByRole('link', { name: 'All products' })).toBeInTheDocument()
    expect(within(crumbs).getByRole('link', { name: 'Mugs' })).toHaveAttribute(
      'href',
      '/products?category=mugs',
    )
  })

  it('shows an active-filter chip that clears just its own filter', async () => {
    const user = userEvent.setup()
    mock.onGet('/categories/tree').reply(200, CATEGORY_TREE_RESPONSE)
    mock.onGet('/products').reply(200, productsResponse([SAMPLE_PRODUCT]))

    renderWithProviders(<ProductListPage />, {
      initialEntries: ['/products?minRating=4&minPrice=100'],
    })

    await screen.findByText('Ceramic Mug')
    await user.click(await screen.findByRole('button', { name: /4\+ stars/ }))

    await waitFor(() => {
      const params = (mock.history.get.at(-1)?.params ?? {}) as Record<string, unknown>
      expect(params.minRating).toBeUndefined()
    })
    expect(mock.history.get.at(-1)?.params).toMatchObject({ minPrice: 100 })
  })

  it('updates category and sub-category filters from the sidebar', async () => {
    const user = userEvent.setup()
    mock.onGet('/categories/tree').reply(200, CATEGORY_TREE_RESPONSE)
    mock.onGet('/products').reply(200, productsResponse([SAMPLE_PRODUCT]))

    renderWithProviders(<ProductListPage />)

    await user.click(await screen.findByRole('button', { name: 'Mugs' }))
    await waitFor(() => {
      expect(mock.history.get.at(-1)?.params).toMatchObject({ categoryId: 'cat-1' })
    })

    await user.click(await screen.findByRole('button', { name: 'Tumblers' }))
    await waitFor(() => {
      expect(mock.history.get.at(-1)?.params).toMatchObject({ categoryId: 'cat-2' })
    })
  })

  it('exposes the minimum-rating filter as one native radio group and selects via keyboard (UX-15)', async () => {
    const user = userEvent.setup()
    mock.onGet('/categories/tree').reply(200, CATEGORY_TREE_RESPONSE)
    mock.onGet('/products').reply(200, productsResponse([SAMPLE_PRODUCT]))

    renderWithProviders(<ProductListPage />)
    await screen.findByText('Ceramic Mug')

    const ratingRadios = screen
      .getByRole('radiogroup', { name: /minimum rating/i })
      .querySelectorAll('input[type="radio"]')
    expect(ratingRadios).toHaveLength(RATING_OPTIONS.length)
    ratingRadios.forEach((r) => expect(r).toHaveAttribute('name', 'minRating'))

    // Tab from the "Max price" field lands on the group's first radio, then
    // ArrowDown moves to and selects the next option (native behavior).
    screen.getByLabelText('Max price').focus()
    await user.tab()
    expect(screen.getByRole('radio', { name: /1\+ stars/ })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('radio', { name: /2\+ stars/ })).toBeChecked()

    await waitFor(() => {
      expect(mock.history.get.at(-1)?.params).toMatchObject({ minRating: 2 })
    })
  })

  it('debounces the price filter — a keystroke does not refetch, blur commits it (UX-10)', async () => {
    const user = userEvent.setup()
    mock.onGet('/categories/tree').reply(200, CATEGORY_TREE_RESPONSE)
    mock.onGet('/products').reply(200, productsResponse([SAMPLE_PRODUCT]))

    renderWithProviders(<ProductListPage />)
    await screen.findByText('Ceramic Mug')

    const priceRequests = () =>
      mock.history.get.filter(
        (r) => r.url === '/products' && (r.params as Record<string, unknown>)?.minPrice !== undefined,
      )

    const minPrice = screen.getByLabelText('Min price')
    await user.type(minPrice, '150')

    // Typing alone must not have fired a refetch with the new bound.
    expect(priceRequests()).toHaveLength(0)

    // Blurring the field flushes the pending value immediately.
    await user.tab()
    await waitFor(() => {
      expect(mock.history.get.at(-1)?.params).toMatchObject({ minPrice: 150 })
    })
    // Still just one request for the whole "150" entry, not one per keystroke.
    expect(priceRequests()).toHaveLength(1)
  })
})
