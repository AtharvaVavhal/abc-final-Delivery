import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '@/features/auth/authContext'
import { ToastProvider } from '@/components/ui/toast/ToastProvider'

/** A stub AuthContextValue — pages under test consume `useAuth()` without
 * needing a real AuthProvider (no mount-time /auth/refresh call, no
 * network mocking required for pure form/validation tests). */
export function createMockAuthContext(
  overrides: Partial<AuthContextValue> = {},
): AuthContextValue {
  return {
    user: null,
    status: 'unauthenticated',
    login: vi.fn().mockResolvedValue(undefined),
    register: vi.fn().mockResolvedValue(undefined),
    loginWithOtp: vi.fn().mockResolvedValue(undefined),
    requestOtp: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

/** A fresh, retry-disabled QueryClient per render — retry:false so a query
 * mocked to fail reaches `isError` immediately instead of the app's real
 * retry:1 default adding a second attempt (and latency) in every test. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
}

interface RenderWithProvidersOptions {
  authValue?: AuthContextValue
  initialEntries?: string[]
  queryClient?: QueryClient
}

export function renderWithProviders(
  ui: ReactElement,
  {
    authValue = createMockAuthContext(),
    initialEntries = ['/'],
    queryClient = createTestQueryClient(),
  }: RenderWithProvidersOptions = {},
) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <AuthContext.Provider value={authValue}>
          <ToastProvider>{ui}</ToastProvider>
        </AuthContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
