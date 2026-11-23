import { Suspense, lazy, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { canUseGeolocation } from '@/hooks/useCurrentLocationPin'
import type { LatLng } from './DeliveryPinMap'
import styles from './DeliveryPin.module.css'

// Leaflet and its CSS load only when a customer actually opens the map.
const DeliveryPinMap = lazy(() => import('./DeliveryPinMap'))

/** ~5.5 m — one press of a nudge button. */
const NUDGE_DEGREES = 0.00005

const round5 = (n: number) => Math.round(n * 1e5) / 1e5

interface DeliveryPinPickerProps {
  value: LatLng | null
  onChange: (value: LatLng | null) => void
  disabled?: boolean
}

type Fix = { status: 'idle' | 'locating' } | { status: 'error'; message: string }

function geolocationMessage(error: GeolocationPositionError): string {
  return error.code === 1
    ? 'Location access was blocked, so we can’t place the pin. You can still order without it.'
    : 'We couldn’t get a precise location. You can still order without a pin.'
}

/**
 * Optional "pin my delivery spot": the customer taps a button, we take one
 * precise GPS fix, and a map opens where they drag the pin onto their door.
 * Opt-in by design — nothing is asked until the tap, nothing is sent unless
 * the pin is left in place at checkout, and the form says who sees it and
 * when it is erased. Keyboard users can move the pin with the nudge buttons.
 */
export function DeliveryPinPicker({ value, onChange, disabled = false }: DeliveryPinPickerProps) {
  const [fix, setFix] = useState<Fix>({ status: 'idle' })
  const [accuracy, setAccuracy] = useState<number | undefined>(undefined)

  if (!canUseGeolocation() && !value) return null

  function place() {
    setFix({ status: 'locating' })
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setAccuracy(pos.coords.accuracy)
        onChange({ latitude: round5(pos.coords.latitude), longitude: round5(pos.coords.longitude) })
        setFix({ status: 'idle' })
      },
      (error) => setFix({ status: 'error', message: geolocationMessage(error) }),
      // A precise fix, taken fresh: this one is for the courier, so unlike the
      // PIN-code lookup it is worth waiting a few seconds for GPS.
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    )
  }

  function nudge(dLat: number, dLng: number) {
    if (!value) return
    onChange({ latitude: round5(value.latitude + dLat), longitude: round5(value.longitude + dLng) })
  }

  return (
    <fieldset className={styles.picker} disabled={disabled}>
      <legend className={styles.legend}>Pin your delivery spot (optional)</legend>
      <p className={styles.explain}>
        Drop a pin on your door so the courier can find you. It’s shared with the courier for this
        delivery only, and erased once your order is delivered.
      </p>

      {!value ? (
        <div className={styles.actions}>
          <Button type="button" variant="secondary" isLoading={fix.status === 'locating'} onClick={place}>
            Pin my spot on the map
          </Button>
          {fix.status === 'error' && (
            <p role="status" className={styles.error}>
              {fix.message}
            </p>
          )}
        </div>
      ) : (
        <div className={styles.mapBlock}>
          <Suspense fallback={<p className={styles.loading}>Loading map…</p>}>
            <DeliveryPinMap position={value} accuracyMeters={accuracy} onMove={(p) => onChange({ latitude: round5(p.latitude), longitude: round5(p.longitude) })} />
          </Suspense>
          {accuracy !== undefined && accuracy > 50 && (
            <p role="status" className={styles.warn}>
              Your device’s location is approximate (about {Math.round(accuracy)} m). Drag the pin to your
              door.
            </p>
          )}
          <p className={styles.shared} role="status">
            This pin will be shared with the courier. Drag it, or tap the map, to put it exactly on your door.
          </p>
          <div className={styles.controls}>
            <div className={styles.nudge} role="group" aria-label="Move the pin">
              <Button type="button" variant="secondary" aria-label="Move pin north" onClick={() => nudge(NUDGE_DEGREES, 0)}>
                ↑
              </Button>
              <Button type="button" variant="secondary" aria-label="Move pin west" onClick={() => nudge(0, -NUDGE_DEGREES)}>
                ←
              </Button>
              <Button type="button" variant="secondary" aria-label="Move pin east" onClick={() => nudge(0, NUDGE_DEGREES)}>
                →
              </Button>
              <Button type="button" variant="secondary" aria-label="Move pin south" onClick={() => nudge(-NUDGE_DEGREES, 0)}>
                ↓
              </Button>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setAccuracy(undefined)
                onChange(null)
              }}
            >
              Remove pin
            </Button>
          </div>
        </div>
      )}
    </fieldset>
  )
}
