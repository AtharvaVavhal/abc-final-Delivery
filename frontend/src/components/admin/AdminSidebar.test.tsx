import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AdminSidebar } from './AdminSidebar'
import { ADMIN_NAV } from './adminNav'
import sidebarSource from './AdminSidebar.tsx?raw'

function renderSidebar(initialPath = '/admin/orders') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AdminSidebar drawerOpen={false} onNavigate={vi.fn()} onClose={vi.fn()} />
    </MemoryRouter>,
  )
}

afterEach(cleanup)

describe('AdminSidebar', () => {
  it('renders every configured admin section as a link to a real route', () => {
    renderSidebar()
    const nav = screen.getByRole('navigation', { name: 'Admin sections' })

    const expected: [string, string][] = [
      ['Overview', '/admin'],
      ['Orders', '/admin/orders'],
      ['Products', '/admin/products'],
      ['Categories', '/admin/categories'],
      ['Customers', '/admin/customers'],
      ['Coupons', '/admin/coupons'],
      ['Settings', '/admin/settings'],
    ]
    for (const [label, href] of expected) {
      expect(within(nav).getByRole('link', { name: label })).toHaveAttribute('href', href)
    }
    // Exactly those 7 — plus the brand link in the header, which is outside <nav>.
    expect(within(nav).getAllByRole('link')).toHaveLength(expected.length)
  })

  it('has no Reviews link and no /admin/reviews route (no list endpoint exists)', () => {
    renderSidebar()
    expect(screen.queryByRole('link', { name: /reviews/i })).not.toBeInTheDocument()

    const hrefs = screen.getAllByRole('link').map((l) => l.getAttribute('href'))
    expect(hrefs).not.toContain('/admin/reviews')
    // Not merely hidden — no nav entry points at it.
    expect(ADMIN_NAV.flatMap((g) => g.items).some((i) => /review/i.test(i.to) || /review/i.test(i.label))).toBe(false)
  })

  it('has no fabricated / non-existent links (no Operations route yet)', () => {
    renderSidebar()
    expect(screen.queryByRole('link', { name: /operations/i })).not.toBeInTheDocument()
    // Every configured route is an absolute /admin path.
    for (const group of ADMIN_NAV) {
      for (const item of group.items) {
        expect(item.to.startsWith('/admin')).toBe(true)
      }
    }
  })

  it('marks the active section with aria-current="page"', () => {
    renderSidebar('/admin/products')
    const active = screen.getByRole('link', { name: 'Products' })
    expect(active).toHaveAttribute('aria-current', 'page')

    // Overview must NOT stay active on a deeper route (it uses `end`).
    expect(screen.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current')
  })

  it('keeps a parent section active on its detail routes', () => {
    renderSidebar('/admin/orders/order-123')
    expect(screen.getByRole('link', { name: 'Orders' })).toHaveAttribute('aria-current', 'page')
  })

  it('groups navigation into visible labelled sections', () => {
    renderSidebar()
    expect(screen.getByText('Manage')).toBeInTheDocument()
    expect(screen.getByText('Configure')).toBeInTheDocument()
  })

  it('is keyboard navigable — Tab reaches the brand then the section links in order', async () => {
    const user = userEvent.setup()
    renderSidebar()

    await user.tab()
    expect(screen.getByRole('link', { name: /ab creations/i })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('link', { name: 'Orders' })).toHaveFocus()
  })

  it('renders the in-drawer close control only when the drawer is open', () => {
    const { rerender } = render(
      <MemoryRouter>
        <AdminSidebar drawerOpen={false} onNavigate={vi.fn()} onClose={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('button', { name: /close admin menu/i })).not.toBeInTheDocument()

    rerender(
      <MemoryRouter>
        <AdminSidebar drawerOpen={true} onNavigate={vi.fn()} onClose={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('button', { name: /close admin menu/i })).toBeInTheDocument()
  })

  it('never hardcodes icon-only links — every entry keeps a visible text label', () => {
    // The source renders <span>{item.label}</span> alongside every icon.
    expect(sidebarSource).toMatch(/<span>\{item\.label\}<\/span>/)
    renderSidebar()
    for (const group of ADMIN_NAV) {
      for (const item of group.items) {
        expect(screen.getByRole('link', { name: item.label })).toBeInTheDocument()
      }
    }
  })
})
