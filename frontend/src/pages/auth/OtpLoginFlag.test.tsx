import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'

// OTP_LOGIN_ENABLED is read at import time, so each case sets the env, resets
// the module registry and imports EVERYTHING it renders fresh — including the
// auth context, so the pages and the provider share one instance.
async function renderAt(path: string, flag: 'true' | 'false') {
  vi.resetModules()
  vi.stubEnv('VITE_AUTH_OTP_ENABLED', flag)
  const { LoginPage } = await import('./LoginPage')
  const { RegisterPage } = await import('./RegisterPage')
  const { AuthContext } = await import('@/features/auth/authContext')
  const { ToastProvider } = await import('@/components/ui/toast/ToastProvider')
  const { createMockAuthContext, createTestQueryClient } = await import('@/test/test-utils')
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <AuthContext.Provider value={createMockAuthContext()}>
        <MemoryRouter initialEntries={[path]}>
          <ToastProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
            </Routes>
          </ToastProvider>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('phone-OTP login flag', () => {
  it('flag on: /login shows the phone form and a staff sign-in link', async () => {
    await renderAt('/login', 'true')
    expect(await screen.findByLabelText(/Mobile number/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Staff sign in' })).toHaveAttribute(
      'href',
      '/login?method=password',
    )
  })

  it('flag on: /login?method=password still shows the email + password form for staff', async () => {
    await renderAt('/login?method=password', 'true')
    expect(await screen.findByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
  })

  it('flag on: /register sends people to the single login page', async () => {
    await renderAt('/register', 'true')
    expect(await screen.findByLabelText(/Mobile number/)).toBeInTheDocument()
  })

  it('flag off: /login is the original email + password page', async () => {
    await renderAt('/login', 'false')
    expect(await screen.findByLabelText('Email')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Mobile number/)).not.toBeInTheDocument()
  })

  it('flag off: /register is the original sign-up form', async () => {
    await renderAt('/register', 'false')
    expect(await screen.findByLabelText('Email')).toBeInTheDocument()
  })
})
