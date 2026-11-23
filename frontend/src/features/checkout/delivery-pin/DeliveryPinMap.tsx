import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import styles from './DeliveryPin.module.css'

export interface LatLng {
  latitude: number
  longitude: number
}

interface DeliveryPinMapProps {
  position: LatLng
  /** Reported accuracy of the device fix, in metres (drawn as a faint circle). */
  accuracyMeters?: number
  onMove: (position: LatLng) => void
}

const ZOOM = 18

/** A round marker drawn with CSS, so no Leaflet image assets are needed. */
const markerIcon = () =>
  L.divIcon({
    className: styles.markerWrap,
    html: `<span class="${styles.marker}"></span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  })

/**
 * The map behind the delivery pin: OpenStreetMap tiles, one draggable marker,
 * and a tap-to-move. Loaded lazily (see DeliveryPinPicker) so Leaflet never
 * weighs down the rest of checkout. Position is controlled by the parent, so
 * the keyboard nudge buttons and the drag stay in sync.
 */
export default function DeliveryPinMap({ position, accuracyMeters, onMove }: DeliveryPinMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const circleRef = useRef<L.Circle | null>(null)
  const onMoveRef = useRef(onMove)
  // Keep the latest callback for the long-lived Leaflet handlers.
  useEffect(() => {
    onMoveRef.current = onMove
  })

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, { zoomControl: true }).setView(
      [position.latitude, position.longitude],
      ZOOM,
    )
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map)

    const marker = L.marker([position.latitude, position.longitude], {
      draggable: true,
      icon: markerIcon(),
      keyboard: false, // keyboard users use the nudge buttons beside the map
      title: 'Your delivery pin — drag it onto your door',
    }).addTo(map)
    marker.on('dragend', () => {
      const p = marker.getLatLng()
      onMoveRef.current({ latitude: p.lat, longitude: p.lng })
    })
    map.on('click', (e: L.LeafletMouseEvent) => {
      marker.setLatLng(e.latlng)
      onMoveRef.current({ latitude: e.latlng.lat, longitude: e.latlng.lng })
    })

    if (accuracyMeters && accuracyMeters > 0) {
      circleRef.current = L.circle([position.latitude, position.longitude], {
        radius: accuracyMeters,
        weight: 1,
        opacity: 0.5,
        fillOpacity: 0.08,
      }).addTo(map)
    }

    mapRef.current = map
    markerRef.current = marker
    return () => {
      map.remove()
      mapRef.current = null
      markerRef.current = null
      circleRef.current = null
    }
    // The map is created once; later position changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Follow the controlled position (nudge buttons, re-locate).
  useEffect(() => {
    const marker = markerRef.current
    const map = mapRef.current
    if (!marker || !map) return
    const current = marker.getLatLng()
    if (current.lat !== position.latitude || current.lng !== position.longitude) {
      marker.setLatLng([position.latitude, position.longitude])
      map.panTo([position.latitude, position.longitude])
    }
  }, [position.latitude, position.longitude])

  return <div ref={containerRef} className={styles.map} role="application" aria-label="Map: drag the pin to your door" />
}
