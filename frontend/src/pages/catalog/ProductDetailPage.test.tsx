import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { apiClient } from '@/services/api/client'
import { createMockAuthContext, renderWithProviders } from '@/test/test-utils'
import type { AuthContextValue } from '@/features/auth/authContext'
import { savePendingCartAdd } from '@/utils/pendingCartAdd'
import { ProductDetailPage } from './ProductDetailPage'

const SAMPLE_PRODUCT = {
  id: 'prod-1',
  categoryId: 'cat-1',
  name: 'Ceramic Mug',
  slug: 'ceramic-mug',
  basePrice: '150',
  minQuantity: 1,
  maxQuantity: 10,
  specifications: { Material: 'Ceramic' },
  isActive: true,
  avgRating: '4.50',
  reviewCount: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  variants: [
    { id: 'var-1', productId: 'prod-1', label: 'Large', priceDelta: '25', isAvailable: true, createdAt: '', updatedAt: '' },
    { id: 'var-2', productId: 'prod-1', label: 'Discontinued', priceDelta: '0', isAvailable: false, createdAt: '', updatedAt: '' },
  ],
  images: [],
  customizationFields: [],
}

const SAMPLE_IMAGE_URL = 'https://res.cloudinary.com/demo/image/upload/ceramic-mug.png'

function renderAtSlug(slug: string, authValue?: AuthContextValue) {
  return renderWithProviders(
    <Routes>
      <Route path="/products/:slug" element={<ProductDetailPage />} />
      <Route path="/login" element={<div>Login Page</div>} />
    </Routes>,
    { initialEntries: [`/products/${slug}`], authValue },
  )
}

const AUTHENTICATED = createMockAuthContext({
  status: 'authenticated',
  user: { id: 'user-1', email: 'shopper@example.test', role: 'CUSTOMER', createdAt: '2026-01-01T00:00:00.000Z' },
})

const NO_VARIANTS_PRODUCT = { ...SAMPLE_PRODUCT, variants: [] }

describe('ProductDetailPage', () => {
  let mock: MockAdapter
  let rootMock: MockAdapter

  beforeEach(() => {
    mock = new MockAdapter(apiClient)
    // client.ts's 401 handler refreshes via the raw axios import, not
    // apiClient (see client.ts's own comment on why) — must be mocked
    // separately or a real, unmocked network call goes out.
    rootMock = new MockAdapter(axios)
    // ReviewList (rendered below the fold on every product) fetches this
    // on mount — an empty list is the harmless default for every test
    // that isn't specifically exercising the reviews section.
    mock.onGet('/products/prod-1/reviews').reply(200, {
      success: true,
      data: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 1 },
    })
  })

  afterEach(() => {
    mock.restore()
    rootMock.restore()
  })

  it("renders the product's name, price, specifications, and variants", async () => {
    mock.onGet('/products/ceramic-mug').reply(200, { success: true, data: SAMPLE_PRODUCT })

    renderAtSlug('ceramic-mug')

    expect(await screen.findByRole('heading', { name: 'Ceramic Mug' })).toBeInTheDocument()
    expect(screen.getByText('₹150.00')).toBeInTheDocument()
    expect(screen.getByText('Material')).toBeInTheDocument()
    expect(screen.getByText('Ceramic')).toBeInTheDocument()
    expect(screen.getByText('Large')).toBeInTheDocument()
    expect(screen.getByText('+₹25.00')).toBeInTheDocument()
    expect(screen.getByText('Discontinued')).toBeInTheDocument()
    expect(screen.getByText('· Unavailable')).toBeInTheDocument()
    // SAMPLE_PRODUCT has no images — a real, expected state, not an error.
    expect(
      screen.getByRole('img', { name: 'Ceramic Mug — no image available' }),
    ).toBeInTheDocument()
  })

  it('places the product heading after the gallery so mobile stacks image then title', async () => {
    mock.onGet('/products/ceramic-mug').reply(200, { success: true, data: SAMPLE_PRODUCT })

    renderAtSlug('ceramic-mug')

    const gallery = await screen.findByRole('img', { name: 'Ceramic Mug — no image available' })
    const heading = screen.getByRole('heading', { name: 'Ceramic Mug', level: 1 })
    expect(gallery.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders the star rating summary near the price', async () => {
    mock.onGet('/products/ceramic-mug').reply(200, { success: true, data: SAMPLE_PRODUCT })

    renderAtSlug('ceramic-mug')

    expect(await screen.findByText('4.50')).toBeInTheDocument()
    expect(screen.getByText('(2 reviews)')).toBeInTheDocument()
  })

  it('shows "No reviews yet" instead of a rating when reviewCount is 0', async () => {
    mock.onGet('/products/ceramic-mug').reply(200, {
      success: true,
      data: { ...SAMPLE_PRODUCT, avgRating: null, reviewCount: 0 },
    })

    renderAtSlug('ceramic-mug')

    expect(await screen.findByText('No reviews yet')).toBeInTheDocument()
  })

  it('renders the paginated review list below the main content', async () => {
    mock.onGet('/products/ceramic-mug').reply(200, { success: true, data: SAMPLE_PRODUCT })
    mock.onGet('/products/prod-1/reviews').reply(200, {
      success: true,
      data: [
        {
          id: 'rev-1',
          productId: 'prod-1',
          userId: 'someone-else',
          rating: 5,
          bodyText: 'Sturdy and looks great.',
          status: 'PUBLISHED',
          createdAt: '2026-01-02T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
      meta: { page: 1, limit: 10, total: 1, totalPages: 1 },
    })

    renderAtSlug('ceramic-mug')
    await screen.findByRole('heading', { name: 'Ceramic Mug' })

    expect(await screen.findByText('Sturdy and looks great.')).toBeInTheDocument()
    expect(screen.getByText('Verified buyer')).toBeInTheDocument()
  })

  it('renders a real <img> when the product has an image', async () => {
    mock.onGet('/products/ceramic-mug').reply(200, {
      success: true,
      data: {
        ...SAMPLE_PRODUCT,
        images: [
          {
            id: 'img-1',
            productId: 'prod-1',
            cloudinaryPublicId: 'printforge/products/ceramic-mug',
            resourceType: 'image',
            deliveryType: 'upload',
            url: SAMPLE_IMAGE_URL,
            sortOrder: 0,
            isPrimary: true,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    })

    renderAtSlug('ceramic-mug')

    const img = await screen.findByRole('img', { name: 'Ceramic Mug' })
    expect(img).toHaveAttribute(
      'src',
      'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,c_limit,w_1200/ceramic-mug.png',
    )
  })

  it('falls back to the placeholder when the image fails to load', async () => {
    mock.onGet('/products/ceramic-mug').reply(200, {
      success: true,
      data: {
        ...SAMPLE_PRODUCT,
        images: [
          {
            id: 'img-1',
            productId: 'prod-1',
            cloudinaryPublicId: 'printforge/products/ceramic-mug',
            resourceType: 'image',
            deliveryType: 'upload',
            url: SAMPLE_IMAGE_URL,
            sortOrder: 0,
            isPrimary: true,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    })

    renderAtSlug('ceramic-mug')

    const img = await screen.findByRole('img', { name: 'Ceramic Mug' })
    fireEvent.error(img)

    expect(screen.queryByRole('img', { name: 'Ceramic Mug' })).not.toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: 'Ceramic Mug — no image available' }),
    ).toBeInTheDocument()
  })

  it('renders an error state for a product that does not exist', async () => {
    mock.onGet('/products/does-not-exist').reply(404, {
      success: false,
      error: { code: 'NOT_FOUND', message: 'Product not found', details: [] },
    })

    renderAtSlug('does-not-exist')

    // UX-46 shared ErrorState: heading + assertive server message + the
    // page's existing "back to shop" recovery link, destination unchanged.
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Product unavailable' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Product not found')
    expect(screen.getByRole('link', { name: /back to shop/i })).toHaveAttribute('href', '/products')
  })

  it('updates the displayed price when a variant with a price delta is selected', async () => {
    const user = userEvent.setup()
    mock.onGet('/products/ceramic-mug').reply(200, { success: true, data: SAMPLE_PRODUCT })

    renderAtSlug('ceramic-mug')
    await screen.findByRole('heading', { name: 'Ceramic Mug' })
    expect(screen.getByText('₹150.00')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /Large/ }))

    expect(screen.getByText('₹175.00')).toBeInTheDocument()
  })

  it('requires a variant to be selected before adding to cart, and never calls the API', async () => {
    const user = userEvent.setup()
    mock.onGet('/products/ceramic-mug').reply(200, { success: true, data: SAMPLE_PRODUCT })

    renderAtSlug('ceramic-mug', AUTHENTICATED)
    await screen.findByRole('heading', { name: 'Ceramic Mug' })

    await user.click(screen.getByRole('button', { name: 'Add to cart' }))

    expect(await screen.findByText('Please select an option above.')).toBeInTheDocument()
    expect(mock.history.post).toHaveLength(0)
  })

  it('adds to cart with the selected variant, quantity, and customization payload', async () => {
    const user = userEvent.setup()
    mock.onGet('/products/ceramic-mug').reply(200, { success: true, data: SAMPLE_PRODUCT })
    mock.onPost('/cart/items').reply(201, {
      success: true,
      data: {
        id: 'item-1',
        productId: 'prod-1',
        productName: 'Ceramic Mug',
        variantId: 'var-1',
        variantLabel: 'Large',
        quantity: 2,
        unitPrice: '175.00',
        lineTotal: '350.00',
        isAvailable: true,
        unavailableReason: null,
        customizations: [],
      },
      meta: { subtotal: '350.00', itemCount: 2 },
    })

    renderAtSlug('ceramic-mug', AUTHENTICATED)
    await screen.findByRole('heading', { name: 'Ceramic Mug' })

    await user.click(screen.getByRole('radio', { name: /Large/ }))
    await user.click(screen.getByRole('button', { name: /increase/i }))
    await user.click(screen.getByRole('button', { name: 'Add to cart' }))

    expect(await screen.findByText('Added to cart')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View cart' })).toHaveAttribute('href', '/cart')
    expect(mock.history.post).toHaveLength(1)
    expect(JSON.parse(mock.history.post[0].data as string)).toEqual({
      productId: 'prod-1',
      variantId: 'var-1',
      quantity: 2,
      customizations: [],
    })
  })

  it('redirects to /login when adding to cart while unauthenticated, without calling the API', async () => {
    const user = userEvent.setup()
    mock.onGet('/products/ceramic-mug').reply(200, {
      success: true,
      data: NO_VARIANTS_PRODUCT,
    })

    renderAtSlug('ceramic-mug')
    await screen.findByRole('heading', { name: 'Ceramic Mug' })

    await user.click(screen.getByRole('button', { name: 'Add to cart' }))

    expect(await screen.findByText('Login Page')).toBeInTheDocument()
    expect(mock.history.post).toHaveLength(0)
  })

  it('resumes a pending add configured before login, then confirms with a View cart toast (UX-03)', async () => {
    mock.onGet('/products/ceramic-mug').reply(200, { success: true, data: SAMPLE_PRODUCT })
    mock.onPost('/cart/items').reply(201, {
      success: true,
      data: {
        id: 'item-1',
        productId: 'prod-1',
        productName: 'Ceramic Mug',
        variantId: 'var-1',
        variantLabel: 'Large',
        quantity: 3,
        unitPrice: '175.00',
        lineTotal: '525.00',
        isAvailable: true,
        unavailableReason: null,
        customizations: [],
      },
      meta: { subtotal: '525.00', itemCount: 3 },
    })

    // As if AddToCartControls stashed this on a logged-out click.
    savePendingCartAdd({
      productId: 'prod-1',
      slug: 'ceramic-mug',
      variantId: 'var-1',
      quantity: 3,
      customizations: [],
    })

    renderAtSlug('ceramic-mug', AUTHENTICATED)

    expect(await screen.findByText('Added to cart')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View cart' })).toHaveAttribute('href', '/cart')

    const addCalls = mock.history.post.filter((r) => r.url === '/cart/items')
    expect(addCalls).toHaveLength(1)
    expect(JSON.parse(addCalls[0].data as string)).toEqual({
      productId: 'prod-1',
      variantId: 'var-1',
      quantity: 3,
      customizations: [],
    })
  })

  it('surfaces the server validation error when adding to cart is rejected', async () => {
    const user = userEvent.setup()
    mock.onGet('/products/ceramic-mug').reply(200, {
      success: true,
      data: NO_VARIANTS_PRODUCT,
    })
    mock.onPost('/cart/items').reply(400, {
      success: false,
      error: { code: 'BAD_REQUEST', message: 'Quantity must be between 1 and 10 for this product', details: [] },
    })

    renderAtSlug('ceramic-mug', AUTHENTICATED)
    await screen.findByRole('heading', { name: 'Ceramic Mug' })

    await user.click(screen.getByRole('button', { name: 'Add to cart' }))

    expect(
      await screen.findByText('Quantity must be between 1 and 10 for this product'),
    ).toBeInTheDocument()
  })

  it('redirects to /login when the add-to-cart request itself 401s (session expired mid-click)', async () => {
    const user = userEvent.setup()
    mock.onGet('/products/ceramic-mug').reply(200, {
      success: true,
      data: NO_VARIANTS_PRODUCT,
    })
    mock.onPost('/cart/items').reply(401, {
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Unauthorized', details: [] },
    })
    // Simulate the refresh attempt also failing — a genuinely expired
    // session, not a recoverable expired-access-token case.
    rootMock.onPost('/auth/refresh').reply(401, {
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Invalid refresh token', details: [] },
    })

    renderAtSlug('ceramic-mug', AUTHENTICATED)
    await screen.findByRole('heading', { name: 'Ceramic Mug' })

    await user.click(screen.getByRole('button', { name: 'Add to cart' }))

    await waitFor(() => {
      expect(screen.getByText('Login Page')).toBeInTheDocument()
    })
  })
})
