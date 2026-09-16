import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthContext } from '@/features/auth/authContext'
import { createMockAuthContext } from '@/test/test-utils'
import { ForbiddenPage } from '@/pages/forbidden/ForbiddenPage'
import { AdminRoute } from './AdminRoute'

function renderAdminRouteTree(authValue: ReturnType<typeof createMockAuthContext>) {
  return render(
    <AuthContext.Provider value={authValue}>
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/login" element={<p>Login page</p>} />
          <Route path="/forbidden" element={<ForbiddenPage />} />
          <Route element={<AdminRoute />}>
            <Route path="/admin" element={<h1>Admin dashboard content</h1>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

describe('AdminRoute', () => {
  it('sends an unauthenticated visitor to /login, not a bare 403', () => {
    renderAdminRouteTree(createMockAuthContext({ status: 'unauthenticated' }))

    expect(screen.getByText('Login page')).toBeInTheDocument()
    expect(screen.queryByText('Admin dashboard content')).not.toBeInTheDocument()
  })

  it('blocks a logged-in non-admin with a distinct "not authorized" page, not the login redirect', () => {
    renderAdminRouteTree(
      createMockAuthContext({
        status: 'authenticated',
        user: { id: 'user-1', email: 'shopper@example.test', role: 'CUSTOMER', createdAt: '2026-01-01T00:00:00.000Z' },
      }),
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Not authorised' })).toBeInTheDocument()
    expect(screen.getByText(/don.t have access/i)).toBeInTheDocument()
    // Never the same outcome an unauthenticated visitor sees — that would
    // falsely read as "you've been logged out."
    expect(screen.queryByText('Login page')).not.toBeInTheDocument()
    expect(screen.queryByText('Admin dashboard content')).not.toBeInTheDocument()
  })

  it('lets an authenticated admin through to the wrapped route', () => {
    renderAdminRouteTree(
      createMockAuthContext({
        status: 'authenticated',
        user: { id: 'admin-1', email: 'admin@example.test', role: 'ADMIN', createdAt: '2026-01-01T00:00:00.000Z' },
      }),
    )

    expect(screen.getByText('Admin dashboard content')).toBeInTheDocument()
  })

  it('shows a loading status while the auth bootstrap is still loading, rather than flash-redirecting', () => {
    renderAdminRouteTree(createMockAuthContext({ status: 'loading' }))

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText(/loading admin/i)).toBeInTheDocument()
    expect(screen.queryByText('Login page')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Not authorised' })).not.toBeInTheDocument()
    expect(screen.queryByText('Admin dashboard content')).not.toBeInTheDocument()
  })
})
