import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import MockAdapter from 'axios-mock-adapter'
import { apiClient } from '@/services/api/client'
import type { UserProfileView } from '@/types/auth'
import { ProfileForm } from './ProfileForm'

const PROFILE = {
  id: 'u1',
  email: 'a@example.test',
  addressLine1: null,
  addressLine2: null,
  city: null,
  state: null,
  postalCode: null,
  country: null,
  phone: null,
  role: 'CUSTOMER',
  createdAt: '2026-01-01T00:00:00Z',
} as UserProfileView

function renderForm(profile: UserProfileView = PROFILE) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return render(
    <ProfileForm profile={profile} isSubmitting={false} submitError={null} onSubmit={vi.fn()} onCancel={vi.fn()} />,
    { wrapper },
  )
}

function stubGeolocation(impl: (ok: PositionCallback, fail: PositionErrorCallback) => void) {
  const getCurrentPosition = vi.fn(impl)
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition },
  })
  return getCurrentPosition
}

describe('ProfileForm — Use my current location', () => {
  let mock: MockAdapter
  beforeEach(() => {
    mock = new MockAdapter(apiClient)
  })
  afterEach(() => {
    mock.restore()
    // @ts-expect-error — removing the stub between tests
    delete navigator.geolocation
    // @ts-expect-error — removing the stub between tests
    delete navigator.permissions
  })

  const settle = () => new Promise((resolve) => setTimeout(resolve, 30))
  const FIX = { coords: { latitude: 18.4575, longitude: 73.8508 } } as GeolocationPosition

  it('says up front that the location is used once and not stored', () => {
    stubGeolocation(() => undefined)
    renderForm()
    expect(screen.getByText(/We don.t store your location/)).toBeInTheDocument()
  })

  it('finds the PIN, city and state by itself, once, when the account has no PIN yet', async () => {
    const getCurrentPosition = stubGeolocation((ok) => ok(FIX))
    mock.onGet('/postal-codes/reverse').reply(200, { success: true, data: { postalCode: '411046' } })
    mock.onGet('/postal-codes/411046').reply(200, {
      success: true,
      data: { postalCode: '411046', city: 'Pune', district: 'Pune', state: 'Maharashtra', country: 'India' },
    })
    renderForm()

    await waitFor(() => expect(screen.getByLabelText('Postal code')).toHaveValue('411046'))
    await waitFor(() => expect(screen.getByLabelText('City')).toHaveValue('Pune'))
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
  })

  it('leaves a saved PIN alone — no lookup at all', async () => {
    const getCurrentPosition = stubGeolocation((ok) => ok(FIX))
    renderForm({ ...PROFILE, postalCode: '400001' })

    await settle()
    expect(getCurrentPosition).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Postal code')).toHaveValue('400001')
  })

  it('does not try again if the browser already blocked location', async () => {
    const getCurrentPosition = stubGeolocation((ok) => ok(FIX))
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: vi.fn().mockResolvedValue({ state: 'denied' }) },
    })
    renderForm()

    await settle()
    expect(getCurrentPosition).not.toHaveBeenCalled()
  })

  it('never overwrites a PIN typed while the automatic lookup was working', async () => {
    let deliverFix: () => void = () => undefined
    const getCurrentPosition = stubGeolocation((ok) => {
      deliverFix = () => ok(FIX)
    })
    mock.onGet('/postal-codes/reverse').reply(200, { success: true, data: { postalCode: '411046' } })
    renderForm()
    await waitFor(() => expect(getCurrentPosition).toHaveBeenCalled())

    await userEvent.type(screen.getByLabelText('Postal code'), '110001')
    deliverFix()
    await settle()

    expect(screen.getByLabelText('Postal code')).toHaveValue('110001')
  })

  it('fills the PIN, then City, State and Country', async () => {
    stubGeolocation((ok) => ok({ coords: { latitude: 18.4575, longitude: 73.8508 } } as GeolocationPosition))
    mock.onGet('/postal-codes/reverse').reply(200, { success: true, data: { postalCode: '411046' } })
    mock.onGet('/postal-codes/411046').reply(200, {
      success: true,
      data: { postalCode: '411046', city: 'Pune', district: 'Pune', state: 'Maharashtra', country: 'India' },
    })
    renderForm()

    await userEvent.click(screen.getByRole('button', { name: 'Use my current location' }))

    await waitFor(() => expect(screen.getByLabelText('Postal code')).toHaveValue('411046'))
    await waitFor(() => expect(screen.getByLabelText('City')).toHaveValue('Pune'))
    expect(screen.getByLabelText('State')).toHaveValue('Maharashtra')
    expect(screen.getByLabelText('Country')).toHaveValue('India')
  })

  it('keeps the PIN even if the city lookup fails', async () => {
    stubGeolocation((ok) => ok({ coords: { latitude: 18.4575, longitude: 73.8508 } } as GeolocationPosition))
    mock.onGet('/postal-codes/reverse').reply(200, { success: true, data: { postalCode: '411046' } })
    mock.onGet('/postal-codes/411046').reply(503)
    renderForm()

    await userEvent.click(screen.getByRole('button', { name: 'Use my current location' }))

    await waitFor(() => expect(screen.getByLabelText('Postal code')).toHaveValue('411046'))
    expect(screen.getByLabelText('City')).toHaveValue('')
  })

  it('explains a blocked permission and leaves the form usable', async () => {
    stubGeolocation((_ok, fail) => fail({ code: 1, PERMISSION_DENIED: 1 } as unknown as GeolocationPositionError))
    renderForm()

    await userEvent.click(screen.getByRole('button', { name: 'Use my current location' }))

    expect(await screen.findByText(/Location access was blocked/)).toBeInTheDocument()
    expect(screen.getByLabelText('Postal code')).toBeEnabled()
  })

  it('hides the button when the browser has no geolocation', () => {
    renderForm()
    expect(screen.queryByRole('button', { name: 'Use my current location' })).not.toBeInTheDocument()
  })
})
