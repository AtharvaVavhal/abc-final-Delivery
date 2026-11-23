import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import MockAdapter from 'axios-mock-adapter'
import { apiClient } from '@/services/api/client'
import { ShippingForm } from './ShippingForm'

vi.mock('./delivery-pin/DeliveryPinMap', () => ({
  default: ({ position }: { position: { latitude: number; longitude: number } }) => (
    <div>pin map at {position.latitude},{position.longitude}</div>
  ),
}))

const PUNE = {
  postalCode: '411046',
  city: 'Pune',
  district: 'Pune',
  state: 'Maharashtra',
  country: 'India',
}

function renderForm(props: Partial<Parameters<typeof ShippingForm>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return render(
    <ShippingForm onSubmit={vi.fn()} isSubmitting={false} {...props} />,
    { wrapper },
  )
}

describe('ShippingForm', () => {
  let mock: MockAdapter

  beforeEach(() => {
    mock = new MockAdapter(apiClient)
    // Common default; tests that use other PINs register their own handler.
    mock.onGet('/postal-codes/411046').reply(200, { success: true, data: PUNE })
  })

  afterEach(() => {
    mock.restore()
  })

  it('marks every schema-required field as required and leaves Address line 2 optional (UX-46)', () => {
    renderForm()
    for (const label of [
      'Recipient name',
      'Phone number',
      'Address line 1',
      'Postal code',
      'City',
      'State',
      'Country',
    ]) {
      expect(screen.getByLabelText(label)).toHaveAttribute('aria-required', 'true')
    }
    expect(screen.getByLabelText('Address line 2 (optional)')).not.toHaveAttribute(
      'aria-required',
    )
    // One "*" per required field, none for the optional one.
    expect(screen.getAllByText('*')).toHaveLength(7)
  })

  it('keeps the address fields editable while the payment script is loading (UX-05)', () => {
    renderForm({ isScriptLoading: true })

    expect(screen.getByLabelText('Recipient name')).toBeEnabled()
    expect(screen.getByLabelText('Address line 1')).toBeEnabled()
    expect(screen.getByLabelText('City')).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Loading payment…' })).toBeDisabled()
  })

  it('disables the fields only while the form is actually submitting', () => {
    renderForm({ isSubmitting: true })

    expect(screen.getByLabelText('Recipient name')).toBeDisabled()
    const submit = screen.getByRole('button', { name: 'Pay now' })
    expect(submit).toBeDisabled()
    expect(submit).toHaveAttribute('aria-busy', 'true')
  })

  it('prefills from a saved address and stays fully editable (UX-07)', async () => {
    const user = userEvent.setup()
    renderForm({
      prefilled: true,
      defaultValues: {
        shippingAddressLine1: '123 Baker St',
        shippingCity: 'Mumbai',
        shippingState: 'Maharashtra',
        shippingPostalCode: '400001',
        shippingCountry: 'India',
        shippingPhone: '9876543210',
      },
    })

    expect(screen.getByText(/Prefilled from your saved address/)).toBeInTheDocument()
    expect(screen.getByLabelText('Address line 1')).toHaveValue('123 Baker St')

    const city = screen.getByLabelText('City')
    await user.clear(city)
    await user.type(city, 'Pune')
    expect(city).toHaveValue('Pune')
  })

  it('submits normalised values', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderForm({ onSubmit })

    await user.type(screen.getByLabelText('Recipient name'), 'Jane Doe')
    await user.type(screen.getByLabelText('Phone number'), '+91 98765 43210')
    await user.type(screen.getByLabelText('Address line 1'), '123 Test St')
    await user.type(screen.getByLabelText('Postal code'), '411046')
    await screen.findByText(/Matched Pune, Maharashtra/)
    await user.click(screen.getByRole('button', { name: 'Pay now' }))

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        shippingRecipientName: 'Jane Doe',
        shippingCity: 'Pune',
        shippingState: 'Maharashtra',
        shippingCountry: 'India',
        // Phone stays as typed in the form values; CheckoutPage converts
        // it to canonical E.164 at submit. The schema guarantees it's
        // normalisable.
        shippingPhone: '+91 98765 43210',
      }),
    )
  })

  describe('phone validation', () => {
    async function typePhoneAndBlur(user: ReturnType<typeof userEvent.setup>, value: string) {
      const phone = screen.getByLabelText('Phone number')
      await user.type(phone, value)
      await user.tab()
    }

    it('accepts a bare 10-digit Indian mobile', async () => {
      const user = userEvent.setup()
      renderForm()
      await typePhoneAndBlur(user, '9876543210')
      expect(
        screen.queryByText(/valid Indian mobile number/),
      ).not.toBeInTheDocument()
    })

    it('accepts the +91 form', async () => {
      const user = userEvent.setup()
      renderForm()
      await typePhoneAndBlur(user, '+919876543210')
      expect(
        screen.queryByText(/valid Indian mobile number/),
      ).not.toBeInTheDocument()
    })

    it('rejects an obviously invalid number on blur', async () => {
      const user = userEvent.setup()
      renderForm()
      await typePhoneAndBlur(user, '12345')
      expect(await screen.findByText(/valid Indian mobile number/)).toBeInTheDocument()
    })
  })

  describe('PIN code lookup', () => {
    it('does not look up until exactly 6 digits are entered', async () => {
      const user = userEvent.setup()
      renderForm()
      await user.type(screen.getByLabelText('Postal code'), '4110')
      // Give any errant request a beat to fire.
      await new Promise((r) => setTimeout(r, 50))
      expect(mock.history.get.filter((r) => r.url?.includes('/postal-codes/'))).toHaveLength(0)
    })

    it('shows a format error for a non-numeric PIN and never looks it up', async () => {
      const user = userEvent.setup()
      renderForm()
      const pin = screen.getByLabelText('Postal code')
      await user.type(pin, '41x0')
      await user.tab()
      expect(await screen.findByText('Enter a valid 6-digit PIN code.')).toBeInTheDocument()
      expect(mock.history.get.filter((r) => r.url?.includes('/postal-codes/'))).toHaveLength(0)
    })

    it('looks up at 6 digits and autofills City / State / Country', async () => {
      const user = userEvent.setup()
      renderForm()
      await user.type(screen.getByLabelText('Postal code'), '411046')

      await waitFor(() => {
        expect(screen.getByLabelText('City')).toHaveValue('Pune')
      })
      expect(screen.getByLabelText('State')).toHaveValue('Maharashtra')
      expect(screen.getByLabelText('Country')).toHaveValue('India')
      expect(screen.getByText(/Matched Pune, Maharashtra/)).toBeInTheDocument()
    })

    it('leaves the autofilled fields editable and does not re-clobber a manual edit', async () => {
      const user = userEvent.setup()
      renderForm()
      await user.type(screen.getByLabelText('Postal code'), '411046')
      await waitFor(() => expect(screen.getByLabelText('City')).toHaveValue('Pune'))

      const city = screen.getByLabelText('City')
      await user.clear(city)
      await user.type(city, 'Katraj')
      // Re-render / same PIN — must not overwrite the manual edit.
      await new Promise((r) => setTimeout(r, 50))
      expect(city).toHaveValue('Katraj')
    })

    it('re-resolves when the PIN changes', async () => {
      const user = userEvent.setup()
      renderForm()
      mock.onGet('/postal-codes/411046').reply(200, { success: true, data: PUNE })
      mock.onGet('/postal-codes/400001').reply(200, {
        success: true,
        data: { postalCode: '400001', city: 'Mumbai', district: 'Mumbai', state: 'Maharashtra', country: 'India' },
      })

      const pin = screen.getByLabelText('Postal code')
      await user.type(pin, '411046')
      await waitFor(() => expect(screen.getByLabelText('City')).toHaveValue('Pune'))

      await user.clear(pin)
      await user.type(pin, '400001')
      await waitFor(() => expect(screen.getByLabelText('City')).toHaveValue('Mumbai'))
    })

    it('a late response for an old PIN does not overwrite the newer one (stale guard)', async () => {
      const user = userEvent.setup()
      renderForm()
      // 411046 is slow; 400001 is fast.
      mock.onGet('/postal-codes/411046').reply(
        () => new Promise((resolve) => setTimeout(() => resolve([200, { success: true, data: PUNE }]), 300)),
      )
      mock.onGet('/postal-codes/400001').reply(200, {
        success: true,
        data: { postalCode: '400001', city: 'Mumbai', district: 'Mumbai', state: 'Maharashtra', country: 'India' },
      })

      const pin = screen.getByLabelText('Postal code')
      await user.type(pin, '411046')
      await user.clear(pin)
      await user.type(pin, '400001')

      await waitFor(() => expect(screen.getByLabelText('City')).toHaveValue('Mumbai'))
      // Wait past the slow response — it must not win.
      await new Promise((r) => setTimeout(r, 350))
      expect(screen.getByLabelText('City')).toHaveValue('Mumbai')
    })

    it('shows a "not found" message and keeps the form usable', async () => {
      const user = userEvent.setup()
      renderForm()
      mock.onGet('/postal-codes/999999').reply(404, {
        success: false,
        error: { code: 'NOT_FOUND', message: "We couldn't find this PIN code. Please check it and try again.", details: [] },
      })

      await user.type(screen.getByLabelText('Postal code'), '999999')
      expect(
        await screen.findByText("We couldn't find this PIN code. Please check it and try again."),
      ).toBeInTheDocument()
      // Fields not autofilled; still editable.
      expect(screen.getByLabelText('City')).toHaveValue('')
      await user.type(screen.getByLabelText('City'), 'Somewhere')
      expect(screen.getByLabelText('City')).toHaveValue('Somewhere')
    })

    it('shows a provider-unavailable message on a 503', async () => {
      const user = userEvent.setup()
      renderForm()
      mock.onGet('/postal-codes/560001').reply(503, {
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message:
            "We couldn't verify this PIN right now. Please check your PIN or enter your address manually.",
          details: [],
        },
      })

      await user.type(screen.getByLabelText('Postal code'), '560001')
      expect(
        await screen.findByText(/enter your address manually/),
      ).toBeInTheDocument()
    })

    it('clears the lookup status when the PIN is emptied', async () => {
      const user = userEvent.setup()
      renderForm()
      const pin = screen.getByLabelText('Postal code')
      await user.type(pin, '411046')
      await screen.findByText(/Matched Pune, Maharashtra/)

      await user.clear(pin)
      await waitFor(() =>
        expect(screen.queryByText(/Matched Pune, Maharashtra/)).not.toBeInTheDocument(),
      )
    })
  })
  describe('Use my current location', () => {
    function stubGeolocation(impl: (ok: PositionCallback, fail: PositionErrorCallback) => void) {
      const getCurrentPosition = vi.fn(impl)
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: { getCurrentPosition },
      })
      return getCurrentPosition
    }

    afterEach(() => {
      // jsdom has no geolocation (or Permissions API) by default.
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

    it('finds the PIN by itself, once, when opened with an empty PIN', async () => {
      const getCurrentPosition = stubGeolocation((ok) => ok(FIX))
      mock.onGet('/postal-codes/reverse').reply(200, { success: true, data: { postalCode: '411046' } })
      renderForm()

      await waitFor(() => expect(screen.getByLabelText('Postal code')).toHaveValue('411046'))
      await waitFor(() => expect(screen.getByLabelText('City')).toHaveValue('Pune'))
      expect(getCurrentPosition).toHaveBeenCalledTimes(1)
    })

    it('leaves a PIN saved on the account alone — no lookup at all', async () => {
      const getCurrentPosition = stubGeolocation((ok) => ok(FIX))
      renderForm({ defaultValues: { shippingPostalCode: '400001' } })

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

    it('never overwrites a PIN the customer typed while the automatic lookup was working', async () => {
      const user = userEvent.setup()
      let deliverFix: () => void = () => undefined
      const getCurrentPosition = stubGeolocation((ok) => {
        deliverFix = () => ok(FIX)
      })
      mock.onGet('/postal-codes/reverse').reply(200, { success: true, data: { postalCode: '411046' } })
      renderForm()
      await waitFor(() => expect(getCurrentPosition).toHaveBeenCalled())

      await user.type(screen.getByLabelText('Postal code'), '110001')
      deliverFix()
      await settle()

      expect(screen.getByLabelText('Postal code')).toHaveValue('110001')
    })

    it('fills the PIN from the position, then City and State from the normal lookup', async () => {
      stubGeolocation((ok) =>
        ok({ coords: { latitude: 18.4575, longitude: 73.8508 } } as GeolocationPosition),
      )
      mock.onGet('/postal-codes/reverse').reply(200, { success: true, data: { postalCode: '411046' } })
      renderForm()

      await userEvent.click(screen.getByRole('button', { name: 'Use my current location' }))

      await waitFor(() => expect(screen.getByLabelText('Postal code')).toHaveValue('411046'))
      await waitFor(() => expect(screen.getByLabelText('City')).toHaveValue('Pune'))
      expect(screen.getByLabelText('State')).toHaveValue('Maharashtra')
      expect(mock.history.get.find((r) => r.url === '/postal-codes/reverse')?.params).toEqual({
        lat: 18.4575,
        lng: 73.8508,
      })
    })

    it('explains a blocked permission and leaves the form usable', async () => {
      stubGeolocation((_ok, fail) =>
        fail({ code: 1, PERMISSION_DENIED: 1 } as unknown as GeolocationPositionError),
      )
      renderForm()

      await userEvent.click(screen.getByRole('button', { name: 'Use my current location' }))

      expect(await screen.findByText(/Location access was blocked/)).toBeInTheDocument()
      expect(screen.getByLabelText('Postal code')).toBeEnabled()
    })

    it('shows the server message when no PIN is found for the spot', async () => {
      stubGeolocation((ok) =>
        ok({ coords: { latitude: 0, longitude: 0 } } as GeolocationPosition),
      )
      mock.onGet('/postal-codes/reverse').reply(404, {
        success: false,
        error: { code: 'NOT_FOUND', message: "We couldn't find a PIN code for your location. Please enter it manually.", details: [] },
      })
      renderForm()

      await userEvent.click(screen.getByRole('button', { name: 'Use my current location' }))

      expect(await screen.findByText(/couldn't find a PIN code for your location/)).toBeInTheDocument()
    })

    it('hides the button when the browser has no geolocation', () => {
      renderForm()
      expect(screen.queryByRole('button', { name: 'Use my current location' })).not.toBeInTheDocument()
    })
  })

  describe('delivery pin (optional)', () => {
    afterEach(() => {
      // @ts-expect-error — removing the stub between tests
      delete navigator.geolocation
    })

    async function fillAddress(user: ReturnType<typeof userEvent.setup>) {
      await user.type(screen.getByLabelText('Recipient name'), 'Jane Doe')
      await user.type(screen.getByLabelText('Phone number'), '9876543210')
      await user.type(screen.getByLabelText('Address line 1'), '123 Test St')
      await user.type(screen.getByLabelText('Postal code'), '411046')
      await screen.findByText(/Matched Pune, Maharashtra/)
    }

    const SPOT_A = {
      postalCode: '411046',
      addressLine1: '7 Kondhwa Main Road',
      addressLine2: 'Kondhwa Budruk',
    }
    const SPOT_B = { postalCode: '411046', addressLine1: '9 Other Road', addressLine2: 'Camp' }

    /** The reverse geocoder answers by position: the first fix is spot A,
     * anything nudged north of it is spot B. */
    function mockReverseByPosition() {
      mock.onGet('/postal-codes/reverse').reply((config) => {
        const lat = (config.params as { lat: number }).lat
        return [200, { success: true, data: lat > 18.45751 ? SPOT_B : SPOT_A }]
      })
    }

    function stubFix() {
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: {
          getCurrentPosition: vi.fn((ok: PositionCallback) =>
            ok({ coords: { latitude: 18.4575, longitude: 73.8508, accuracy: 10 } } as GeolocationPosition),
          ),
        },
      })
    }

    const SLOW = { timeout: 4000 }

    it('fills the street and area from the pin once it is placed, and says so', async () => {
      const user = userEvent.setup()
      stubFix()
      mockReverseByPosition()
      renderForm()

      await user.click(screen.getByRole('button', { name: 'Pin my spot on the map' }))

      await waitFor(() => expect(screen.getByLabelText('Address line 1')).toHaveValue('7 Kondhwa Main Road'), SLOW)
      expect(screen.getByLabelText('Address line 2 (optional)')).toHaveValue('Kondhwa Budruk')
      expect(await screen.findByText(/We filled in your address from the pin/)).toBeInTheDocument()
    })

    it('never overwrites an address line the customer already typed', async () => {
      const user = userEvent.setup()
      stubFix()
      mockReverseByPosition()
      renderForm()

      await user.type(screen.getByLabelText('Address line 1'), 'Flat 4, My Building')
      await user.click(screen.getByRole('button', { name: 'Pin my spot on the map' }))

      await waitFor(() => expect(screen.getByLabelText('Address line 2 (optional)')).toHaveValue('Kondhwa Budruk'), SLOW)
      expect(screen.getByLabelText('Address line 1')).toHaveValue('Flat 4, My Building')
    })

    it('follows the pin when it is moved, but stops once the customer edits what it filled', async () => {
      const user = userEvent.setup()
      stubFix()
      mockReverseByPosition()
      renderForm()
      await user.click(screen.getByRole('button', { name: 'Pin my spot on the map' }))
      await waitFor(() => expect(screen.getByLabelText('Address line 1')).toHaveValue('7 Kondhwa Main Road'), SLOW)

      // Moving the pin updates what was filled automatically.
      await user.click(screen.getByRole('button', { name: 'Move pin north' }))
      await waitFor(() => expect(screen.getByLabelText('Address line 1')).toHaveValue('9 Other Road'), SLOW)
      expect(screen.getByLabelText('Address line 2 (optional)')).toHaveValue('Camp')

      // Once the customer changes a line it is theirs for good.
      const line1 = screen.getByLabelText('Address line 1')
      await user.clear(line1)
      await user.type(line1, 'Plot 7, Shahunagar')
      await user.click(screen.getByRole('button', { name: 'Move pin south' }))
      await waitFor(() => expect(screen.getByLabelText('Address line 2 (optional)')).toHaveValue('Kondhwa Budruk'), SLOW)
      expect(screen.getByLabelText('Address line 1')).toHaveValue('Plot 7, Shahunagar')
    })

    it('leaves the form alone when the spot has no usable address', async () => {
      const user = userEvent.setup()
      stubFix()
      mock.onGet('/postal-codes/reverse').reply(200, {
        success: true,
        data: { postalCode: '411046', addressLine1: null, addressLine2: null },
      })
      renderForm()

      await user.click(screen.getByRole('button', { name: 'Pin my spot on the map' }))
      await screen.findByText('pin map at 18.4575,73.8508')
      await new Promise((resolve) => setTimeout(resolve, 900))

      expect(screen.getByLabelText('Address line 1')).toHaveValue('')
      expect(screen.queryByText(/We filled in your address from the pin/)).not.toBeInTheDocument()
      // ...but it says so, instead of looking like nothing happened.
      expect(await screen.findByText(/The map has no street name for this exact spot/)).toBeInTheDocument()
      expect(screen.getByText(/Your pin is still saved for the courier/)).toBeInTheDocument()
    })

    it('shows what it found even when the answer is the same as before, so the customer can see it ran', async () => {
      const user = userEvent.setup()
      stubFix()
      mockReverseByPosition()
      renderForm()
      await user.click(screen.getByRole('button', { name: 'Pin my spot on the map' }))
      await waitFor(() => expect(screen.getByLabelText('Address line 1')).toHaveValue('7 Kondhwa Main Road'), SLOW)

      expect(await screen.findByText(/Nearest street at this pin: 7 Kondhwa Main Road, Kondhwa Budruk\./)).toBeInTheDocument()
      expect(screen.getByText(/We filled in your address from the pin/)).toBeInTheDocument()
    })

    it('says the customer\'s own address was kept when they had typed one', async () => {
      const user = userEvent.setup()
      stubFix()
      mockReverseByPosition()
      renderForm()
      await user.type(screen.getByLabelText('Address line 1'), 'Flat 4, My Building')
      await user.type(screen.getByLabelText('Address line 2 (optional)'), 'Near the park')
      await user.click(screen.getByRole('button', { name: 'Pin my spot on the map' }))

      expect(await screen.findByText(/Nearest street at this pin: 7 Kondhwa Main Road/, undefined, SLOW)).toBeInTheDocument()
      expect(screen.getByText(/Your own address was left as you typed it/)).toBeInTheDocument()
      expect(screen.getByLabelText('Address line 1')).toHaveValue('Flat 4, My Building')
    })

    it('takes back a line the pin filled when the new spot has none, but not one the customer wrote', async () => {
      const user = userEvent.setup()
      stubFix()
      mock.onGet('/postal-codes/reverse').reply((config) => {
        const lat = (config.params as { lat: number }).lat
        return [
          200,
          {
            success: true,
            data:
              lat > 18.45751
                ? { postalCode: '411046', addressLine1: '9 Other Road', addressLine2: null }
                : SPOT_A,
          },
        ]
      })
      renderForm()
      await user.click(screen.getByRole('button', { name: 'Pin my spot on the map' }))
      await waitFor(() => expect(screen.getByLabelText('Address line 2 (optional)')).toHaveValue('Kondhwa Budruk'), SLOW)

      await user.click(screen.getByRole('button', { name: 'Move pin north' }))
      await waitFor(() => expect(screen.getByLabelText('Address line 1')).toHaveValue('9 Other Road'), SLOW)
      // The new spot has no area, so the old one is cleared.
      expect(screen.getByLabelText('Address line 2 (optional)')).toHaveValue('')
    })

    it('tells the customer when the address lookup fails, and still keeps the pin', async () => {
      const user = userEvent.setup()
      stubFix()
      mock.onGet('/postal-codes/reverse').reply(503, {
        success: false,
        error: { code: 'UNAVAILABLE', message: 'nope', details: [] },
      })
      renderForm()

      await user.click(screen.getByRole('button', { name: 'Pin my spot on the map' }))

      expect(await screen.findByText(/couldn.t look up the address for this spot right now/, undefined, SLOW)).toBeInTheDocument()
      expect(screen.getByText('pin map at 18.4575,73.8508')).toBeInTheDocument()
    })

    it('sends no coordinates unless the customer placed a pin', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      renderForm({ onSubmit })

      await fillAddress(user)
      await user.click(screen.getByRole('button', { name: 'Pay now' }))

      await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled())
      const values = onSubmit.mock.calls[0][0] as Record<string, unknown>
      expect(values.shippingLatitude).toBeUndefined()
      expect(values.shippingLongitude).toBeUndefined()
    })

    it('sends the pin with the address once the customer has placed one, and drops it when removed', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: {
          getCurrentPosition: vi.fn((ok: PositionCallback) =>
            ok({ coords: { latitude: 18.4575, longitude: 73.8508, accuracy: 10 } } as GeolocationPosition),
          ),
        },
      })
      renderForm({ onSubmit })

      await fillAddress(user)
      await user.click(screen.getByRole('button', { name: 'Pin my spot on the map' }))
      expect(await screen.findByText('pin map at 18.4575,73.8508')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Pay now' }))

      await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
      expect(onSubmit.mock.calls[0][0]).toEqual(
        expect.objectContaining({ shippingLatitude: 18.4575, shippingLongitude: 73.8508 }),
      )

      // Removing the pin takes it out of the next submission.
      await user.click(screen.getByRole('button', { name: 'Remove pin' }))
      await user.click(screen.getByRole('button', { name: 'Pay now' }))
      await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2))
      const second = onSubmit.mock.calls[1][0] as Record<string, unknown>
      expect(second.shippingLatitude).toBeUndefined()
      expect(second.shippingLongitude).toBeUndefined()
    })
  })
})
