import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import MockAdapter from 'axios-mock-adapter'
import { apiClient } from '@/services/api/client'
import { STORE_LOGO_FALLBACK, useStoreLogo } from './useStoreLogo'

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

describe('useStoreLogo', () => {
  let mock: MockAdapter

  beforeEach(() => {
    mock = new MockAdapter(apiClient)
  })
  afterEach(() => {
    mock.restore()
  })

  it('starts on the bundled logo before the request resolves', () => {
    mock.onGet('/settings').reply(() => new Promise(() => {}))
    const { result } = renderHook(() => useStoreLogo(), { wrapper: wrapper() })
    expect(result.current).toBe(STORE_LOGO_FALLBACK)
  })

  it('returns the configured logo URL once loaded', async () => {
    mock
      .onGet('/settings')
      .reply(200, { success: true, data: { data: { storeLogo: 'https://cdn.example/logo.png' } } })
    const { result } = renderHook(() => useStoreLogo(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current).toBe('https://cdn.example/logo.png'))
  })

  it('falls back to the bundled logo when the value is blank', async () => {
    mock.onGet('/settings').reply(200, { success: true, data: { data: { storeLogo: '' } } })
    const { result } = renderHook(() => useStoreLogo(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current).toBe(STORE_LOGO_FALLBACK))
  })

  it('falls back to the bundled logo when the endpoint errors', async () => {
    mock.onGet('/settings').reply(500)
    const { result } = renderHook(() => useStoreLogo(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current).toBe(STORE_LOGO_FALLBACK))
  })
})
