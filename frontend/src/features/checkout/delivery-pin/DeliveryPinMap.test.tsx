import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

// A minimal Leaflet stand-in: records how the wrapper drives it. Created with
// vi.hoisted because vi.mock is hoisted above ordinary top-level constants.
const { L, map, marker, handlers, mapHandlers } = vi.hoisted(() => {
  const handlers: Record<string, (e?: unknown) => void> = {}
  const mapHandlers: Record<string, (e?: unknown) => void> = {}
  const map = {
    setView: vi.fn(),
    on: vi.fn((event: string, fn: (e?: unknown) => void) => {
      mapHandlers[event] = fn
      return map
    }),
    panTo: vi.fn(),
    remove: vi.fn(),
  }
  map.setView.mockReturnValue(map)
  const marker = {
    addTo: vi.fn(),
    on: vi.fn((event: string, fn: (e?: unknown) => void) => {
      handlers[event] = fn
      return marker
    }),
    getLatLng: vi.fn(() => ({ lat: 18.4575, lng: 73.8508 })),
    setLatLng: vi.fn(),
  }
  marker.addTo.mockReturnValue(marker)
  const circle = { addTo: vi.fn() }
  circle.addTo.mockReturnValue(circle)
  const L = {
    map: vi.fn(() => map),
    tileLayer: vi.fn<(url: string, options: { attribution: string }) => { addTo: () => void }>(() => ({
      addTo: vi.fn(),
    })),
    marker: vi.fn<(latlng: unknown, options: { draggable: boolean; keyboard: boolean }) => typeof marker>(
      () => marker,
    ),
    circle: vi.fn(() => circle),
    divIcon: vi.fn(() => ({})),
  }
  return { L, map, marker, handlers, mapHandlers }
})
vi.mock('leaflet', () => ({ default: L, ...L }))
vi.mock('leaflet/dist/leaflet.css', () => ({}))

import DeliveryPinMap from './DeliveryPinMap'

beforeEach(() => vi.clearAllMocks())

describe('DeliveryPinMap', () => {
  it('draws OpenStreetMap tiles with attribution and a draggable, mouse-only marker', () => {
    render(<DeliveryPinMap position={{ latitude: 18.4575, longitude: 73.8508 }} onMove={vi.fn()} />)

    expect(map.setView).toHaveBeenCalledWith([18.4575, 73.8508], 18)
    const [url, options] = L.tileLayer.mock.calls[0]
    expect(url).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png')
    expect(options.attribution).toContain('OpenStreetMap')
    expect(L.marker.mock.calls[0][1]).toMatchObject({ draggable: true, keyboard: false })
  })

  it('reports where the marker was dropped', () => {
    const onMove = vi.fn()
    render(<DeliveryPinMap position={{ latitude: 18.4575, longitude: 73.8508 }} onMove={onMove} />)
    marker.getLatLng.mockReturnValueOnce({ lat: 18.46, lng: 73.86 })
    handlers.dragend()
    expect(onMove).toHaveBeenCalledWith({ latitude: 18.46, longitude: 73.86 })
  })

  it('moves the marker and reports the spot when the map is tapped', () => {
    const onMove = vi.fn()
    render(<DeliveryPinMap position={{ latitude: 18.4575, longitude: 73.8508 }} onMove={onMove} />)
    mapHandlers.click({ latlng: { lat: 18.47, lng: 73.87 } })
    expect(marker.setLatLng).toHaveBeenCalledWith({ lat: 18.47, lng: 73.87 })
    expect(onMove).toHaveBeenCalledWith({ latitude: 18.47, longitude: 73.87 })
  })

  it('draws the accuracy circle only when an accuracy is known', () => {
    const { unmount } = render(<DeliveryPinMap position={{ latitude: 1, longitude: 2 }} accuracyMeters={40} onMove={vi.fn()} />)
    expect(L.circle).toHaveBeenCalledTimes(1)
    unmount()
    L.circle.mockClear()
    render(<DeliveryPinMap position={{ latitude: 1, longitude: 2 }} onMove={vi.fn()} />)
    expect(L.circle).not.toHaveBeenCalled()
  })

  it('follows the position when it changes from outside (the nudge buttons)', () => {
    const { rerender } = render(<DeliveryPinMap position={{ latitude: 18.4575, longitude: 73.8508 }} onMove={vi.fn()} />)
    rerender(<DeliveryPinMap position={{ latitude: 18.45755, longitude: 73.8508 }} onMove={vi.fn()} />)
    expect(marker.setLatLng).toHaveBeenCalledWith([18.45755, 73.8508])
    expect(map.panTo).toHaveBeenCalledWith([18.45755, 73.8508])
  })

  it('tears the map down on unmount', () => {
    const { unmount } = render(<DeliveryPinMap position={{ latitude: 1, longitude: 2 }} onMove={vi.fn()} />)
    unmount()
    expect(map.remove).toHaveBeenCalledTimes(1)
  })
})
