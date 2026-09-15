import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LeftNavSidebar } from './LeftNavSidebar'

vi.mock('@/hooks/useCategoryTree', () => ({
  useCategoryTree: () => ({
    data: [
      { id: 'cat-1', name: 'Business Cards', slug: 'business-cards', parentCategoryId: null, children: [] },
      { id: 'cat-2', name: 'name plats', slug: 'plats', parentCategoryId: null, children: [] },
    ],
    isLoading: false,
  }),
}))

vi.mock('@/hooks/useProducts', () => ({
  useProducts: () => ({
    data: {
      items: [
        { id: 'prod-1', name: 'Standard Business Cards', slug: 'standard-cards', categoryId: 'cat-1' },
        { id: 'prod-2', name: 'Matte Business Cards', slug: 'matte-cards', categoryId: 'cat-1' },
        { id: 'prod-3', name: 'Mukund Villa LED Name Plate', slug: 'mukund-villa', categoryId: 'cat-2' },
      ],
    },
    isLoading: false,
  }),
}))

function renderSidebar() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LeftNavSidebar />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(cleanup)

describe('LeftNavSidebar', () => {
  it('renders search input and navigation links', () => {
    renderSidebar()

    expect(screen.getByPlaceholderText('Search Products/Services')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Home/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /About Us/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Contact Us/i })).toBeInTheDocument()
    expect(screen.getByText('Products & Services')).toBeInTheDocument()
  })

  it('renders category rows with computed product counts and formats typos', () => {
    renderSidebar()

    expect(screen.getByText('Business Cards')).toBeInTheDocument()
    expect(screen.getByText('(2)')).toBeInTheDocument()
    expect(screen.getByText('Name Plates')).toBeInTheDocument()
    expect(screen.getByText('(1)')).toBeInTheDocument()
  })

  it('expands dropdown when chevron is clicked to reveal products and view all link', async () => {
    const user = userEvent.setup()
    renderSidebar()

    // Initially products are not visible in dropdown
    expect(screen.queryByText('Standard Business Cards')).not.toBeInTheDocument()

    // Click dropdown toggle for Business Cards
    const toggleBtn = screen.getByRole('button', { name: /Toggle Business Cards dropdown/i })
    await user.click(toggleBtn)

    // Now products and view all link appear in dropdown
    expect(screen.getByText('Standard Business Cards')).toBeInTheDocument()
    expect(screen.getByText('Matte Business Cards')).toBeInTheDocument()
    expect(screen.getByText(/View all Business Cards/i)).toBeInTheDocument()

    // Click again to close
    await user.click(toggleBtn)
    expect(screen.queryByText('Standard Business Cards')).not.toBeInTheDocument()
  })
})
