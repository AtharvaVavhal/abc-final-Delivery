import { useEffect, useRef } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { shippingSchema, type ShippingFormValues } from '@/schemas/checkout.schema'
import { usePostalLookup } from '@/hooks/usePostalLookup'
import { canUseGeolocation, useCurrentLocationPin } from '@/hooks/useCurrentLocationPin'
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

  // "Use my location": asked for only on tap. Only the resulting PIN is
  // written into the form; the normal PIN lookup above then fills City /
  // State / Country, exactly as if the customer had typed it.
  const location = useCurrentLocationPin()
  async function handleUseLocation() {
    const pin = await location.locate()
    if (!pin) return
    setValue('shippingPostalCode', pin, {
      shouldValidate: true,
      shouldDirty: true,
      shouldTouch: true,
    })
  }

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
