import { useEffect, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { shippingSchema, type ShippingFormValues } from '@/schemas/checkout.schema'
import { usePostalLookup } from '@/hooks/usePostalLookup'
import { canUseGeolocation, useAutoLocate, useCurrentLocationPin } from '@/hooks/useCurrentLocationPin'
import { reverseLookupPostalCode } from '@/services/api/postal'
import { DeliveryPinPicker } from './delivery-pin/DeliveryPinPicker'
import { TextField } from '@/components/ui/TextField'
import { Button } from '@/components/ui/Button'
import styles from './ShippingForm.module.css'

interface ShippingFormProps {
  onSubmit: (values: ShippingFormValues) => void
  isSubmitting: boolean
  /** True only while the Razorpay Checkout.js script is loading — it gates
   * the final submit action, never the fields (UX-05): the script loads
   * after "Pay now", so blocking data entry on it is never correct. */
  isScriptLoading?: boolean
  /** Saved shipping details from the customer's profile — used as the
   * form's initial values so a returning customer doesn't re-type their
   * address (UX-07). Every field stays freely editable. */
  defaultValues?: Partial<ShippingFormValues>
  /** Show the "prefilled from your saved address" hint. */
  prefilled?: boolean
}

const EMPTY_VALUES: ShippingFormValues = {
  shippingRecipientName: '',
  shippingPhone: '',
  shippingAddressLine1: '',
  shippingAddressLine2: '',
  shippingCity: '',
  shippingState: '',
  shippingPostalCode: '',
  shippingCountry: '',
}

/** Collects shipping details for a fresh checkout. Initial values may be
 * seeded from the customer's saved profile address (§11 still keeps an
 * immutable snapshot onto the order regardless).
 *
 * PIN-code assist: once the Postal code field holds exactly six digits the
 * form looks the PIN up (via the backend proxy) and fills City / State /
 * Country from the result. Those fields stay fully editable; a given
 * lookup result is applied exactly once, so manual edits are never
 * clobbered on re-render, and only a *new* PIN re-applies. A failed or
 * unavailable lookup never blocks the form — the customer can type the
 * address by hand. */
export function ShippingForm({
  onSubmit,
  isSubmitting,
  isScriptLoading,
  defaultValues,
  prefilled = false,
}: ShippingFormProps) {
  const {
    register,
    handleSubmit,
    control,
    setValue,
    getValues,
    formState: { errors, dirtyFields },
  } = useForm<ShippingFormValues>({
    // Validate on blur (and on submit) — not on every keystroke.
    mode: 'onTouched',
    resolver: zodResolver(shippingSchema),
    defaultValues: { ...EMPTY_VALUES, ...defaultValues },
  })

  // useWatch (a subscription hook), not the form instance's own watch()
  // function — same reasoning as CustomizationForm / ReviewForm.
  const postalCodeValue =
    useWatch({ control, name: 'shippingPostalCode', defaultValue: '' }) ?? ''
  // Only look a PIN up once the customer has actually touched the field —
  // a PIN seeded from the saved profile address (UX-07) must not trigger a
  // lookup that overwrites the rest of that saved address on mount.
  const pinTouched = Boolean(dirtyFields.shippingPostalCode)
  const lookup = usePostalLookup(pinTouched ? postalCodeValue : '')

  // The last lookup result we applied, so a re-render / refetch of the same
  // PIN never re-fills over the customer's manual edits — only a genuinely
  // new PIN result does.
  const appliedPinRef = useRef<string | null>(null)

  useEffect(() => {
    if (lookup.status !== 'success' || !lookup.data) return
    const result = lookup.data
    if (appliedPinRef.current === result.postalCode) return

    setValue('shippingCity', result.city, { shouldValidate: true, shouldDirty: true })
    setValue('shippingState', result.state, { shouldValidate: true, shouldDirty: true })
    setValue('shippingCountry', result.country, { shouldValidate: true, shouldDirty: true })
    appliedPinRef.current = result.postalCode
  }, [lookup.status, lookup.data, setValue])

  // When the PIN is cleared / shortened, forget the applied result so
  // re-entering it later re-fills.
  useEffect(() => {
    if (!/^\d{6}$/.test(postalCodeValue.trim())) {
      appliedPinRef.current = null
    }
  }, [postalCodeValue])

  const pinStatus = describePinStatus(lookup)

  // Optional delivery pin: lives in the form values (so it is submitted with
  // the address) but has no input of its own.
  const pinLat = useWatch({ control, name: 'shippingLatitude' })
  const pinLng = useWatch({ control, name: 'shippingLongitude' })
  const deliveryPin =
    pinLat !== undefined && pinLng !== undefined ? { latitude: pinLat, longitude: pinLng } : null

  // What the location / the pin has filled in so far. A field is only ever
  // (re)filled while it is empty or still holds exactly that value — once the
  // customer edits it, it is theirs and is never touched again.
  const autoFilled = useRef<Partial<Record<'shippingAddressLine1' | 'shippingAddressLine2' | 'shippingPostalCode', string>>>({})
  const [addressFromPin, setAddressFromPin] = useState(false)
  // What the lookup for the current pin is doing / found, so the customer can
  // see it ran even when the answer is the same as before.
  const [pinLookup, setPinLookup] = useState<
    { state: 'idle' } | { state: 'looking' } | { state: 'error' } | { state: 'found'; label: string | null }
  >({ state: 'idle' })

  // After the pin settles (short pause, so dragging or nudging doesn't fire a
  // request per step), suggest the street, area and PIN at that spot.
  useEffect(() => {
    if (pinLat === undefined || pinLng === undefined) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setPinLookup({ state: 'looking' })
      reverseLookupPostalCode(pinLat, pinLng, controller.signal)
        .then((suggestion) => {
          let changed = false
          const fill = (
            field: 'shippingAddressLine1' | 'shippingAddressLine2' | 'shippingPostalCode',
            value: string | null,
          ) => {
            const current = (getValues(field) ?? '').trim()
            if (!value) {
              // The new spot has nothing for this line: take back a line the
              // pin filled earlier (it no longer describes this spot), but
              // never one the customer wrote.
              if (field !== 'shippingPostalCode' && current !== '' && current === autoFilled.current[field]) {
                setValue(field, '', { shouldValidate: true, shouldDirty: true, shouldTouch: true })
                delete autoFilled.current[field]
                changed = true
              }
              return
            }
            if (current !== '' && current !== autoFilled.current[field]) return
            if (current !== value) {
              setValue(field, value, { shouldValidate: true, shouldDirty: true, shouldTouch: true })
              changed = true
            }
            autoFilled.current[field] = value
          }
          fill('shippingAddressLine1', suggestion.addressLine1)
          fill('shippingAddressLine2', suggestion.addressLine2)
          fill('shippingPostalCode', suggestion.postalCode)
          if (changed) setAddressFromPin(true)
          const label = [suggestion.addressLine1, suggestion.addressLine2].filter(Boolean).join(', ')
          setPinLookup({ state: 'found', label: label || null })
        })
        .catch((error: unknown) => {
          // Advisory only: the customer can always type the address. A request
          // we cancelled ourselves (the pin moved on) is not an error.
          if (!controller.signal.aborted && !(error instanceof Error && error.name === 'CanceledError')) {
            setPinLookup({ state: 'error' })
          }
        })
    }, 700)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [pinLat, pinLng, getValues, setValue])

  // "Use my location": asked for only on tap. Only the resulting PIN is
  // written into the form; the normal PIN lookup above then fills City /
  // State / Country, exactly as if the customer had typed it.
  const location = useCurrentLocationPin()
  async function handleUseLocation(auto = false) {
    const pin = await location.locate()
    if (!pin) return
    // An automatic attempt must never overwrite a PIN the customer typed
    // while it was working; a tap on the button always may.
    if (auto && getValues('shippingPostalCode').trim() !== '') return
    autoFilled.current.shippingPostalCode = pin
    setValue('shippingPostalCode', pin, {
      shouldValidate: true,
      shouldDirty: true,
      shouldTouch: true,
    })
  }

  // On open with an empty PIN (a PIN saved on the account is left alone),
  // look it up from the device location by itself.
  useAutoLocate(postalCodeValue.trim() === '', () => void handleUseLocation(true))

  return (
    <form className={styles.form} onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate>
      {prefilled && (
        <p className={styles.prefilledNote}>
          Prefilled from your saved address — edit any field as needed.
        </p>
      )}
      <TextField
        label="Recipient name"
        required
        autoComplete="name"
        error={errors.shippingRecipientName?.message}
        {...register('shippingRecipientName')}
        disabled={isSubmitting}
      />
      <TextField
        label="Phone number"
        required
        type="tel"
        autoComplete="tel"
        inputMode="tel"
        placeholder="9876543210"
        error={errors.shippingPhone?.message}
        {...register('shippingPhone')}
        disabled={isSubmitting}
      />
      <TextField
        label="Address line 1"
        required
        autoComplete="address-line1"
        error={errors.shippingAddressLine1?.message}
        {...register('shippingAddressLine1')}
        disabled={isSubmitting}
      />
      <TextField
        label="Address line 2 (optional)"
        autoComplete="address-line2"
        error={errors.shippingAddressLine2?.message}
        {...register('shippingAddressLine2')}
        disabled={isSubmitting}
      />
      {canUseGeolocation() && (
        <div className={styles.locationAssist}>
          <Button
            type="button"
            variant="secondary"
            isLoading={location.status === 'locating'}
            disabled={isSubmitting}
            onClick={() => void handleUseLocation()}
          >
            Use my current location
          </Button>
          <p className={styles.locationNote} role="status" data-variant={location.status === 'error' ? 'error' : undefined}>
            {location.status === 'error' && location.message
              ? location.message
              : 'Used once to find your PIN code. We don’t store your location.'}
          </p>
        </div>
      )}
      <div className={styles.row}>
        <div className={styles.pinField}>
          <TextField
            label="Postal code"
            required
            autoComplete="postal-code"
            inputMode="numeric"
            maxLength={6}
            placeholder="411046"
            error={errors.shippingPostalCode?.message}
            {...register('shippingPostalCode')}
            disabled={isSubmitting}
          />
          {/* Live region so the lookup status (loading / matched / error)
              is announced without stealing focus. Kept separate from the
              field's own validation error, which TextField wires up via
              aria-describedby itself. */}
          <p className={styles.pinStatus} data-variant={pinStatus.variant} role="status">
            {pinStatus.text}
          </p>
        </div>
        <TextField
          label="City"
          required
          autoComplete="address-level2"
          error={errors.shippingCity?.message}
          {...register('shippingCity')}
          disabled={isSubmitting}
        />
      </div>
      <div className={styles.row}>
        <TextField
          label="State"
          required
          autoComplete="address-level1"
          error={errors.shippingState?.message}
          {...register('shippingState')}
          disabled={isSubmitting}
        />
        <TextField
          label="Country"
          required
          autoComplete="country-name"
          error={errors.shippingCountry?.message}
          {...register('shippingCountry')}
          disabled={isSubmitting}
        />
      </div>

      <DeliveryPinPicker
        value={deliveryPin}
        disabled={isSubmitting}
        onChange={(pin) => {
          setValue('shippingLatitude', pin?.latitude, { shouldDirty: true })
          setValue('shippingLongitude', pin?.longitude, { shouldDirty: true })
          if (!pin) {
            setAddressFromPin(false)
            setPinLookup({ state: 'idle' })
          }
        }}
      />
      {deliveryPin && pinLookup.state !== 'idle' && (
        <p className={styles.pinAddressNote} role="status" data-variant={pinLookup.state === 'error' ? 'error' : undefined}>
          {pinLookup.state === 'looking' && 'Checking this spot…'}
          {pinLookup.state === 'error' && 'We couldn’t look up the address for this spot right now. Please type it in.'}
          {pinLookup.state === 'found' &&
            (pinLookup.label
              ? `Nearest street at this pin: ${pinLookup.label}. ${
                  addressFromPin
                    ? 'We filled in your address from the pin. Please check it and edit anything that’s not right.'
                    : 'Your own address was left as you typed it.'
                }`
              : 'The map has no street name for this exact spot, so please type your address. Your pin is still saved for the courier.')}
        </p>
      )}

      <Button
        type="submit"
        isLoading={isSubmitting}
        className={styles.submit}
        disabled={isSubmitting || isScriptLoading}
      >
        {isScriptLoading ? 'Loading payment…' : 'Pay now'}
      </Button>
    </form>
  )
}

function describePinStatus(
  lookup: ReturnType<typeof usePostalLookup>,
): { text: string; variant: 'muted' | 'success' | 'error' } {
  switch (lookup.status) {
    case 'loading':
      return { text: 'Looking up postal code…', variant: 'muted' }
    case 'success':
      return lookup.data
        ? {
            text: `Matched ${lookup.data.district}, ${lookup.data.state} — edit below if needed.`,
            variant: 'success',
          }
        : { text: '', variant: 'muted' }
    case 'error':
      return lookup.errorKind === 'not-found'
        ? {
            text: "We couldn't find this PIN code. Please check it and try again.",
            variant: 'error',
          }
        : {
            text: "We couldn't verify this PIN right now. Please check your PIN or enter your address manually.",
            variant: 'error',
          }
    default:
      return { text: '', variant: 'muted' }
  }
}
