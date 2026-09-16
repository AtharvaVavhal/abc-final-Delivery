import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import MockAdapter from 'axios-mock-adapter'
import { apiClient } from '@/services/api/client'
import { AuthContext } from '@/features/auth/authContext'
import { ToastProvider } from '@/components/ui/toast/ToastProvider'
import {
  createMockAuthContext,
  createTestQueryClient,
  renderWithProviders,
} from '@/test/test-utils'
import { Header } from './Header'

const ADMIN = {
  id: 'admin-1',
  email: 'admin@example.test',
  role: 'ADMIN' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
}
const CUSTOMER = {
  id: 'user-1',
  email: 'shopper@example.test',
  role: 'CUSTOMER' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
}

describe('Header', () => {
  let mock: MockAdapter
  let publicSettings: Record<string, string>

  beforeEach(() => {
    mock = new MockAdapter(apiClient)
    publicSettings = {
      storeName: 'PrintForge',
      storeLogo: '/catalog/logo.png',
    }
    mock
      .onGet('/cart')
      .reply(200, { success: true, data: { id: 'cart-1', items: [], itemCount: 0, subtotal: '0.00' } })
    mock.onGet('/categories/tree').reply(200, { success: true, data: [] })
    mock.onGet('/settings').reply(() => [
      200,
      { success: true, data: { data: { ...publicSettings } } },
    ])
  })

  afterEach(() => {
    mock.restore()
  })

  it('renders the store logo as the brand, labelled with the configured store name', async () => {
    publicSettings.storeName = 'Atharva Prints'
    renderWithProviders(<Header />, { authValue: createMockAuthContext({ status: 'unauthenticated' }) })

    const brand = await screen.findByRole('link', { name: 'Atharva Prints home' })
    expect(brand).toHaveAttribute('href', '/')
    expect(brand.querySelector('img')).toHaveAttribute('src', '/catalog/logo.png')
    expect(screen.queryByText('Atharva Prints')).not.toBeInTheDocument()
    expect(screen.queryByText('PrintForge')).not.toBeInTheDocument()
  })

  it('uses the storeLogo setting as the navbar image', async () => {
    publicSettings.storeLogo = 'https://cdn.example/custom-logo.png'
    renderWithProviders(<Header />, { authValue: createMockAuthContext({ status: 'unauthenticated' }) })

    const brand = await screen.findByRole('link', { name: 'AB Creations home' })
    await waitFor(() =>
      expect(brand.querySelector('img')).toHaveAttribute(
        'src',
        'https://cdn.example/custom-logo.png',
      ),
    )
  })

  it('falls back to "AB Creations" as the brand label when the store-name endpoint fails', async () => {
    mock.resetHandlers()
    mock
      .onGet('/cart')
      .reply(200, { success: true, data: { id: 'cart-1', items: [], itemCount: 0, subtotal: '0.00' } })
    mock.onGet('/categories/tree').reply(200, { success: true, data: [] })
    mock.onGet('/settings').reply(500)
    renderWithProviders(<Header />, { authValue: createMockAuthContext({ status: 'unauthenticated' }) })

    const brand = await screen.findByRole('link', { name: 'AB Creations home' })
    expect(brand.querySelector('img')).toHaveAttribute('src', '/catalog/logo.png')
    expect(screen.queryByText('AB Creations')).not.toBeInTheDocument()
  })

  it('does not show PrintForge branding when the store-name setting is still the platform default', async () => {
    renderWithProviders(<Header />, { authValue: createMockAuthContext({ status: 'unauthenticated' }) })

    expect(await screen.findByRole('link', { name: 'AB Creations home' })).toBeInTheDocument()
    expect(screen.queryByText('PrintForge')).not.toBeInTheDocument()
  })

  it('renders Home and live category names from the category tree, not hardcoded catalog labels', async () => {
    mock.onGet('/categories/tree').reply(200, {
      success: true,
      data: [
        {
          id: 'cat-1',
          name: 'Magnetic Badges',
          slug: 'magnetic-badges',
          parentCategoryId: null,
          children: [],
        },
        {
          id: 'cat-2',
          name: 'Acrylic Clocks',
          slug: 'acrylic-clocks',
          parentCategoryId: null,
          children: [],
        },
      ],
    })
    renderWithProviders(<Header />, { authValue: createMockAuthContext({ status: 'unauthenticated' }) })

    expect(await screen.findByRole('link', { name: 'Magnetic Badges' })).toHaveAttribute(
      'href',
      '/products?categoryId=cat-1',
    )
    expect(screen.getByRole('link', { name: 'Acrylic Clocks' })).toHaveAttribute(
      'href',
      '/products?categoryId=cat-2',
    )
    const categoryNav = screen.getByRole('navigation', { name: 'Product categories' })
    expect(within(categoryNav).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/')
    expect(screen.queryByRole('link', { name: 'Business Cards' })).not.toBeInTheDocument()
  })

  it('folds extra categories into More so a large catalog cannot overflow the bar', async () => {
    mock.onGet('/categories/tree').reply(200, {
      success: true,
      data: Array.from({ length: 8 }, (_, index) => ({
        id: `cat-${index}`,
        name: `Category ${index + 1}`,
        slug: `category-${index + 1}`,
        parentCategoryId: null,
        children: [],
      })),
    })
    renderWithProviders(<Header />, { authValue: createMockAuthContext({ status: 'unauthenticated' }) })

    expect(await screen.findByRole('link', { name: 'Category 1' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Category 3' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Category 4' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByRole('menuitem', { name: 'Category 4' })).toHaveAttribute(
      'href',
      '/products?categoryId=cat-3',
    )
    expect(screen.getByRole('menuitem', { name: 'Category 8' })).toBeInTheDocument()
  })

  it('sends an unauthenticated visitor to login from the account icon', () => {
    renderWithProviders(<Header />, { authValue: createMockAuthContext({ status: 'unauthenticated' }) })
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login')
  })

  it('shows the Admin nav entry for an authenticated ADMIN user', () => {
    renderWithProviders(<Header />, {
      authValue: createMockAuthContext({ status: 'authenticated', user: ADMIN }),
    })
    expect(screen.getAllByRole('link', { name: 'Admin' }).length).toBeGreaterThan(0)
  })

  it('never shows the Admin nav entry to a logged-in CUSTOMER, not even as a dead link', () => {
    renderWithProviders(<Header />, {
      authValue: createMockAuthContext({ status: 'authenticated', user: CUSTOMER }),
    })
    expect(screen.queryAllByRole('link', { name: 'Admin' })).toHaveLength(0)
  })

  it('does not show the Admin nav entry to an unauthenticated visitor', () => {
    renderWithProviders(<Header />, { authValue: createMockAuthContext({ status: 'unauthenticated' }) })
    expect(screen.queryAllByRole('link', { name: 'Admin' })).toHaveLength(0)
  })

  it('does not print the raw account email in the header', () => {
    renderWithProviders(<Header />, {
      authValue: createMockAuthContext({ status: 'authenticated', user: CUSTOMER }),
    })
    expect(screen.queryByText(CUSTOMER.email)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute('href', '/account')
  })

  it('keeps the cart reachable for a signed-out visitor', () => {
    renderWithProviders(<Header />, { authValue: createMockAuthContext({ status: 'unauthenticated' }) })
    expect(screen.getByRole('link', { name: /cart/i })).toHaveAttribute('href', '/cart')
  })

  it('keeps the category-nav loading placeholder decorative — no bogus "Loading categories" announcement', async () => {
    mock.resetHandlers()
    mock.onGet('/cart').reply(200, { success: true, data: { id: 'c', items: [], itemCount: 0, subtotal: '0.00' } })
    mock.onGet('/settings').reply(200, {
      success: true,
      data: { data: { storeName: 'PrintForge', storeLogo: '/catalog/logo.png' } },
    })
    mock.onGet('/categories/tree').reply(() => new Promise(() => {})) // never settles → stays in the loading branch

    renderWithProviders(<Header />, { authValue: createMockAuthContext({ status: 'unauthenticated' }) })

    // The category bar is still a labelled landmark while its contents load…
    expect(await screen.findByRole('navigation', { name: 'Product categories' })).toBeInTheDocument()
    // …but the shimmer placeholder is hidden from assistive tech, matching
    // the homepage rails — it is not a live region and carries no label.
    expect(screen.queryByLabelText('Loading categories')).not.toBeInTheDocument()
  })

  it('renders a product search in the bar and inside the mobile nav drawer', () => {
    renderWithProviders(<Header />, { authValue: createMockAuthContext({ status: 'unauthenticated' }) })

    // Both are always in the DOM; CSS shows the right one per breakpoint.
    expect(screen.getAllByRole('search', { hidden: true })).toHaveLength(2)

    const drawer = document.getElementById('mobile-nav') as HTMLElement
    expect(within(drawer).getByRole('search', { hidden: true })).toBeInTheDocument()
    expect(
      within(drawer).getByPlaceholderText('Search products…'),
    ).toBeInTheDocument()
  })

  it('exposes account + orders + log out inside the nav drawer for an authenticated user (UX-16)', () => {
    renderWithProviders(<Header />, {
      authValue: createMockAuthContext({ status: 'authenticated', user: CUSTOMER }),
    })
    const drawer = document.getElementById('mobile-nav') as HTMLElement
    // The drawer is always in the DOM; CSS toggles it open per breakpoint.
    expect(within(drawer).getByRole('link', { name: 'My account', hidden: true })).toBeInTheDocument()
    expect(within(drawer).getByRole('link', { name: 'My orders', hidden: true })).toBeInTheDocument()
    // The auth cluster now collapses into the drawer below 560px, so logout
    // must be reachable there and not only in the top row.
    expect(
      within(drawer).getByRole('button', { name: 'Log out', hidden: true }),
    ).toBeInTheDocument()
  })

  it('keeps Log in / Create an account inside the nav drawer for a signed-out visitor (UX-16)', () => {
    renderWithProviders(<Header />, { authValue: createMockAuthContext({ status: 'unauthenticated' }) })
    const drawer = document.getElementById('mobile-nav') as HTMLElement
    expect(
      within(drawer).getByRole('link', { name: 'Log in', hidden: true }),
    ).toHaveAttribute('href', '/login')
    expect(
      within(drawer).getByRole('link', { name: 'Create an account', hidden: true }),
    ).toHaveAttribute('href', '/register')
  })

  it('keeps a category dropdown open while the pointer travels from the trigger into the menu', async () => {
    mock.onGet('/categories/tree').reply(200, {
      success: true,
      data: [
        {
          id: 'parent-1',
          name: 'Acrylic Gifts',
          slug: 'acrylic-gifts',
          parentCategoryId: null,
          children: [
            {
              id: 'child-1',
              name: 'Acrylic Photos',
              slug: 'acrylic-photos',
              parentCategoryId: 'parent-1',
              children: [],
            },
          ],
        },
      ],
    })
    renderWithProviders(<Header />, { authValue: createMockAuthContext({ status: 'unauthenticated' }) })

    const trigger = await screen.findByRole('button', { name: /Acrylic Gifts/ })
    const item = trigger.closest('li')
    expect(item).not.toBeNull()

    fireEvent.mouseEnter(item!)
    expect(await screen.findByRole('menuitem', { name: 'Acrylic Photos' })).toBeInTheDocument()

    fireEvent.mouseLeave(item!)
    expect(screen.getByRole('menuitem', { name: 'Acrylic Photos' })).toBeInTheDocument()

    fireEvent.mouseEnter(item!)
    expect(screen.getByRole('menuitem', { name: 'Acrylic Photos' })).toBeInTheDocument()
  })

  it('closes the category dropdown after the pointer has left and the grace period ends', async () => {
    mock.onGet('/categories/tree').reply(200, {
      success: true,
      data: [
        {
          id: 'parent-1',
          name: 'Acrylic Gifts',
          slug: 'acrylic-gifts',
          parentCategoryId: null,
          children: [
            {
              id: 'child-1',
              name: 'Acrylic Photos',
              slug: 'acrylic-photos',
              parentCategoryId: 'parent-1',
              children: [],
            },
          ],
        },
      ],
    })
    renderWithProviders(<Header />, { authValue: createMockAuthContext({ status: 'unauthenticated' }) })

    const trigger = await screen.findByRole('button', { name: /Acrylic Gifts/ })
    const item = trigger.closest('li')!
    fireEvent.mouseEnter(item)
    expect(await screen.findByRole('menuitem', { name: 'Acrylic Photos' })).toBeInTheDocument()

    fireEvent.mouseLeave(item)
    await waitFor(() => {
      expect(screen.queryByRole('menuitem', { name: 'Acrylic Photos' })).not.toBeInTheDocument()
    })
  })

  it('logs out from the drawer and collapses it afterwards (UX-16)', async () => {
    const logout = vi.fn().mockResolvedValue(undefined)
    renderWithProviders(<Header />, {
      authValue: createMockAuthContext({ status: 'authenticated', user: CUSTOMER, logout }),
    })

    // Open the drawer (its trigger is display:none in jsdom — media queries
    // aren't evaluated — so drive it with fireEvent).
    const menuButton = screen.getByLabelText('Open menu')
    fireEvent.click(menuButton)
    expect(menuButton).toHaveAttribute('aria-expanded', 'true')

    const drawer = document.getElementById('mobile-nav') as HTMLElement
    fireEvent.click(within(drawer).getByRole('button', { name: 'Log out', hidden: true }))

    expect(logout).toHaveBeenCalledTimes(1)
    // onAfterLogout runs once logout resolves and collapses the drawer.
    await vi.waitFor(() => expect(menuButton).toHaveAttribute('aria-expanded', 'false'))
  })

  it('carries the current storefront location as state.from on the "Create an account" link (UX-04)', () => {
    function StateEcho() {
      const loc = useLocation()
      return <div data-testid="reg-state">{JSON.stringify(loc.state)}</div>
    }
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <AuthContext.Provider value={createMockAuthContext({ status: 'unauthenticated' })}>
          <MemoryRouter initialEntries={['/products?category=mugs']}>
            <ToastProvider>
              <Header />
              <Routes>
                <Route path="/products" element={<div>catalog</div>} />
                <Route path="/register" element={<StateEcho />} />
              </Routes>
            </ToastProvider>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('link', { name: 'Create an account', hidden: true }))

    const state = JSON.parse(
      screen.getByTestId('reg-state').textContent || 'null',
    ) as { from?: { pathname?: string; search?: string } } | null
    expect(state?.from?.pathname).toBe('/products')
    expect(state?.from?.search).toBe('?category=mugs')
  })

  it('omits state.from on "Create an account" when the header is already on an auth page', () => {
    function StateEcho() {
      const loc = useLocation()
      return <div data-testid="reg-state">{JSON.stringify(loc.state)}</div>
    }
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <AuthContext.Provider value={createMockAuthContext({ status: 'unauthenticated' })}>
          <MemoryRouter initialEntries={['/login']}>
            <ToastProvider>
              <Header />
              <Routes>
                <Route path="/login" element={<div>login</div>} />
                <Route path="/register" element={<StateEcho />} />
              </Routes>
            </ToastProvider>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('link', { name: 'Create an account', hidden: true }))
    expect(screen.getByTestId('reg-state').textContent).toBe('null')
  })
})
