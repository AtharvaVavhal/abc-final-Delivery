import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DeliveryPinPicker } from './DeliveryPinPicker'

// The real map needs Leaflet + a browser; the picker only cares that it gets
// a position and can report a move.
vi.mock('./DeliveryPinMap', () => ({
  default: ({ position, onMove }: { position: { latitude: number; longitude: number }; onMove: (p: { latitude: number; longitude: number }) => void }) => (
    <div>
      <span>map at {position.latitude},{position.longitude}</span>
      <button type="button" onClick={() => onMove({ latitude: 18.123456789, longitude: 73.987654321 })}>
        drag marker
      </button>
    </div>
  ),
}))

function stubGeolocation(impl: (ok: PositionCallback, fail: PositionErrorCallback, options?: PositionOptions) => void) {
  const getCurrentPosition = vi.fn(impl)
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition } })
  return getCurrentPosition
}

afterEach(() => {
  // @ts-expect-error — removing the stub between tests
  delete navigator.geolocation
})

describe('DeliveryPinPicker', () => {
  it('renders nothing when the browser cannot share a location and no pin is set', () => {
    const { container } = render(<DeliveryPinPicker value={null} onChange={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('says who sees the pin and when it is erased, and asks for nothing until tapped', () => {
    const getCurrentPosition = stubGeolocation(() => undefined)
    render(<DeliveryPinPicker value={null} onChange={vi.fn()} />)
    expect(screen.getByText(/shared with the courier for this delivery only, and erased once your order is delivered/)).toBeInTheDocument()
    expect(getCurrentPosition).not.toHaveBeenCalled()
  })

  it('takes one precise, fresh fix on tap and reports it rounded to ~1 m', async () => {
    const onChange = vi.fn()
    const getCurrentPosition = stubGeolocation((ok) =>
      ok({ coords: { latitude: 18.457512345, longitude: 73.850812345, accuracy: 12 } } as GeolocationPosition),
    )
    render(<DeliveryPinPicker value={null} onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: 'Pin my spot on the map' }))

    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
    expect(getCurrentPosition.mock.calls[0][2]).toMatchObject({ enableHighAccuracy: true, maximumAge: 0 })
    expect(onChange).toHaveBeenCalledWith({ latitude: 18.45751, longitude: 73.85081 })
  })

  it('explains a blocked permission and sets no pin', async () => {
    const onChange = vi.fn()
    stubGeolocation((_ok, fail) => fail({ code: 1, PERMISSION_DENIED: 1 } as unknown as GeolocationPositionError))
    render(<DeliveryPinPicker value={null} onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: 'Pin my spot on the map' }))

    expect(await screen.findByText(/Location access was blocked.*still order without it/)).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('shows the map, tells the customer the pin will be shared, and lets them drag it', async () => {
    const onChange = vi.fn()
    stubGeolocation(() => undefined)
    render(<DeliveryPinPicker value={{ latitude: 18.4575, longitude: 73.8508 }} onChange={onChange} />)

    expect(await screen.findByText('map at 18.4575,73.8508')).toBeInTheDocument()
    expect(screen.getByText(/This pin will be shared with the courier/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'drag marker' }))
    expect(onChange).toHaveBeenCalledWith({ latitude: 18.12346, longitude: 73.98765 })
  })

  it('has keyboard-friendly nudge buttons that move the pin about 5 m', async () => {
    const onChange = vi.fn()
    stubGeolocation(() => undefined)
    render(<DeliveryPinPicker value={{ latitude: 18.4575, longitude: 73.8508 }} onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: 'Move pin north' }))
    expect(onChange).toHaveBeenLastCalledWith({ latitude: 18.45755, longitude: 73.8508 })
    await userEvent.click(screen.getByRole('button', { name: 'Move pin west' }))
    expect(onChange).toHaveBeenLastCalledWith({ latitude: 18.4575, longitude: 73.85075 })
    await userEvent.click(screen.getByRole('button', { name: 'Move pin east' }))
    expect(onChange).toHaveBeenLastCalledWith({ latitude: 18.4575, longitude: 73.85085 })
    await userEvent.click(screen.getByRole('button', { name: 'Move pin south' }))
    expect(onChange).toHaveBeenLastCalledWith({ latitude: 18.45745, longitude: 73.8508 })
  })

  it('removes the pin on request', async () => {
    const onChange = vi.fn()
    stubGeolocation(() => undefined)
    render(<DeliveryPinPicker value={{ latitude: 18.4575, longitude: 73.8508 }} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Remove pin' }))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('warns when the device fix is only approximate', async () => {
    const onChange = vi.fn()
    stubGeolocation((ok) => ok({ coords: { latitude: 18.4575, longitude: 73.8508, accuracy: 900 } } as GeolocationPosition))
    const { rerender } = render(<DeliveryPinPicker value={null} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Pin my spot on the map' }))
    rerender(<DeliveryPinPicker value={{ latitude: 18.4575, longitude: 73.8508 }} onChange={onChange} />)

    expect(await screen.findByText(/approximate \(about 900 m\)/)).toBeInTheDocument()
  })

  it('is disabled while the order is being submitted', () => {
    stubGeolocation(() => undefined)
    render(<DeliveryPinPicker value={null} onChange={vi.fn()} disabled />)
    expect(screen.getByRole('button', { name: 'Pin my spot on the map' })).toBeDisabled()
  })
})
