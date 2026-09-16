import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import MockAdapter from 'axios-mock-adapter'
import { apiClient } from '@/services/api/client'
import { STORE_NAME_FALLBACK, useStoreName } from './useStoreName'

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

describe('useStoreName', () => {
  let mock: MockAdapter

  beforeEach(() => {
    mock = new MockAdapter(apiClient)
  })
  afterEach(() => {
    mock.restore()
  })

  it('starts on the "AB Creations" fallback before the request resolves', () => {
    mock.onGet('/settings').reply(() => new Promise(() => {}))
    const { result } = renderHook(() => useStoreName(), { wrapper: wrapper() })
    expect(result.current).toBe('AB Creations')
    expect(STORE_NAME_FALLBACK).toBe('AB Creations')
  })

  it('returns the configured store name once loaded', async () => {
    mock.onGet('/settings').reply(200, { success: true, data: { data: { storeName: 'Atharva Prints' } } })
    const { result } = renderHook(() => useStoreName(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current).toBe('Atharva Prints'))
  })

  it('trims whitespace around the configured name', async () => {
    mock
      .onGet('/settings')
      .reply(200, { success: true, data: { data: { storeName: '  Atharva Prints  ' } } })
    const { result } = renderHook(() => useStoreName(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current).toBe('Atharva Prints'))
  })

  it('falls back to "AB Creations" when the value is null or blank', async () => {
    mock.onGet('/settings').reply(200, { success: true, data: { data: {} } })
    const { result } = renderHook(() => useStoreName(), { wrapper: wrapper() })
    // Give the query a tick to settle; the value stays on the fallback.
    await waitFor(() => expect(result.current).toBe('AB Creations'))
  })

  it('falls back to "AB Creations" when the endpoint errors', async () => {
    mock.onGet('/settings').reply(500)
    const { result } = renderHook(() => useStoreName(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current).toBe('AB Creations'))
  })
})
