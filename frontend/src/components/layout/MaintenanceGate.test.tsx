import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MockAdapter from 'axios-mock-adapter'
import { apiClient } from '@/services/api/client'
import { createTestQueryClient, renderWithProviders } from '@/test/test-utils'
import { STOREFRONT_PUBLIC_SETTINGS_QUERY_KEY } from '@/hooks/useStorefrontPublicSettings'
import { MaintenanceGate } from './MaintenanceGate'

const response = (enabled: boolean, extra: Record<string, string> = {}) => ({
  success: true,
  data: {
    data: { maintenance_mode: String(enabled), storeName: 'Test store', ...extra },
  },
})

describe('MaintenanceGate', () => {
  let mock: MockAdapter
  beforeEach(() => {
    mock = new MockAdapter(apiClient)
  })
  afterEach(() => {
    cleanup()
    mock.restore()
    vi.useRealTimers()
  })

  function renderGate(path = '/', client = createTestQueryClient()) {
    return renderWithProviders(
      <MaintenanceGate>
        <h1>Requested route</h1>
      </MaintenanceGate>,
      { initialEntries: [path], queryClient: client },
    )
  }

  it.each([
    '/',
    '/products/mug',
    '/cart',
    '/checkout',
    '/orders/123/invoice',
    '/register',
    '/unknown',
    '/administrator',
    '/login-help',
  ])('replaces customer route %s during maintenance', async (path) => {
    mock.onGet('/settings').reply(200, response(true))
    renderGate(path)
    expect(
      await screen.findByRole('heading', {
        name: 'We’ll be right back.',
      }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Requested route')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Test store' })).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Store admin sign in' }),
    ).toHaveAttribute('href', '/login')
  })

  it('offers Contact us only through channels the store has published', async () => {
    mock.onGet('/settings').replyOnce(
      200,
      response(true, { whatsappNumber: '+91 98765 43210', storeContactEmail: 'hi@example.com' }),
    )
    const first = renderGate()
    expect(await screen.findByRole('link', { name: 'Contact us' })).toHaveAttribute(
      'href',
      'https://wa.me/919876543210',
    )
    first.unmount()

    mock.onGet('/settings').replyOnce(200, response(true, { storeContactEmail: 'hi@example.com' }))
    const second = renderGate()
    expect(await screen.findByRole('link', { name: 'Contact us' })).toHaveAttribute(
      'href',
      'mailto:hi@example.com',
    )
    second.unmount()

    mock.onGet('/settings').replyOnce(200, response(true))
    renderGate()
    await screen.findByRole('heading', { name: 'We’ll be right back.' })
    expect(screen.queryByRole('link', { name: 'Contact us' })).not.toBeInTheDocument()
  })

  it('credits FORGE and links to its site', async () => {
    mock.onGet('/settings').reply(200, response(true))
    renderGate()
    const credit = await screen.findByRole('link', { name: /A product of\s*FORGE/ })
    expect(credit).toHaveAttribute('href', 'https://forgebuilds.in')
  })

  it.each([
    '/login',
    '/login/',
    '/LOGIN',
    '/admin',
    '/admin/settings',
    '/admin/orders/123',
  ])('keeps %s reachable without waiting for settings', (path) => {
    mock.onGet('/settings').networkError()
    renderGate(path)
    expect(screen.getByText('Requested route')).toBeInTheDocument()
    expect(mock.history.get).toHaveLength(0)
  })

  it('shows customer routes when the setting is off', async () => {
    mock.onGet('/settings').reply(200, response(false))
    renderGate()
    expect(await screen.findByText('Requested route')).toBeInTheDocument()
  })

  it('waits for live settings even with a cached off value', async () => {
    const client = createTestQueryClient()
    client.setQueryData(STOREFRONT_PUBLIC_SETTINGS_QUERY_KEY, {
      maintenance_mode: false,
    })
    let finish!: (value: [number, unknown]) => void
    mock.onGet('/settings').reply(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    renderGate('/', client)
    expect(screen.getByText('Checking store availability')).toBeInTheDocument()
    expect(screen.queryByText('Requested route')).not.toBeInTheDocument()
    await waitFor(() => expect(finish).toBeTypeOf('function'))
    act(() => {
      finish([200, response(true)])
    })
    expect(
      await screen.findByText('We’ll be right back.'),
    ).toBeInTheDocument()
  })

  it('allows retrying an initial network failure without showing customer content', async () => {
    const user = userEvent.setup()
    mock.onGet('/settings').networkErrorOnce()
    mock.onGet('/settings').reply(200, response(false))
    renderGate()
    expect(
      await screen.findByText('We couldn’t reach the store.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Requested route')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Check again' }))
    expect(await screen.findByText('Requested route')).toBeInTheDocument()
  })

  it('keeps maintenance visible if checking again fails, then restores the route when switched off', async () => {
    const user = userEvent.setup()
    mock.onGet('/settings').replyOnce(200, response(true))
    mock.onGet('/settings').networkErrorOnce()
    mock.onGet('/settings').reply(200, response(false))
    renderGate('/checkout')
    await screen.findByText('We’ll be right back.')
    await user.click(screen.getByRole('button', { name: 'Check again' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We couldn’t check for updates',
    )
    expect(screen.queryByText('Requested route')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Check again' }))
    expect(await screen.findByText('Requested route')).toBeInTheDocument()
  })

  it('picks up on and off changes in an open tab by polling', async () => {
    vi.useFakeTimers()
    let enabled = false
    mock.onGet('/settings').reply(() => [200, response(enabled)])
    renderGate()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(screen.getByText('Requested route')).toBeInTheDocument()
    enabled = true
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_001)
    })
    expect(screen.getByText('We’ll be right back.')).toBeInTheDocument()
    enabled = false
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_001)
    })
    expect(screen.getByText('Requested route')).toBeInTheDocument()
  })
})
