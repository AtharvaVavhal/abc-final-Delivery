import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { canUseGeolocation, useAutoLocate, useCurrentLocationPin } from '@/hooks/useCurrentLocationPin'
import { lookupPostalCode } from '@/services/api/postal'
import { accountSchema, type AccountFormValues } from '@/schemas/account.schema'
import { TextField } from '@/components/ui/TextField'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Alert'
import type { UserProfileView } from '@/types/auth'
import styles from './ProfileForm.module.css'

interface ProfileFormProps {
  profile: UserProfileView
  isSubmitting: boolean
  submitError: string | null
  onSubmit: (values: AccountFormValues) => void
  onCancel: () => void
}

/**
 * Edits exactly the 7 fields PATCH /users/me accepts (confirmed live —
 * anything else gets a 400, whitelist + forbidNonWhitelisted:true on the
 * backend). Email is deliberately not a field here at all, not just
 * disabled — AccountPage renders it read-only outside this form, and
 * there is no change-email endpoint to wire it to. Same reason there's no
 * name field (doesn't exist on User, frozen schema) and no password
 * fields (no in-app change-password endpoint).
 */
export function ProfileForm({ profile, isSubmitting, submitError, onSubmit, onCancel }: ProfileFormProps) {
  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<AccountFormValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: {
      addressLine1: profile.addressLine1 ?? '',
      addressLine2: profile.addressLine2 ?? '',
      city: profile.city ?? '',
      state: profile.state ?? '',
      postalCode: profile.postalCode ?? '',
      country: profile.country ?? '',
      phone: profile.phone ?? '',
    },
  })

  // "Use my current location": asked for only on tap. The PIN is written in,
  // then City / State / Country are filled from it the same way the checkout
  // form does; if that lookup fails the PIN still stays and the rest can be
  // typed. The position itself is never stored.
  const location = useCurrentLocationPin()
  async function handleUseLocation(auto = false) {
    const pin = await location.locate()
    if (!pin) return
    // Never overwrite a PIN the customer typed while an automatic attempt ran.
    if (auto && getValues('postalCode').trim() !== '') return
    const touch = { shouldValidate: true, shouldDirty: true, shouldTouch: true }
    setValue('postalCode', pin, touch)
    try {
      const place = await lookupPostalCode(pin)
      setValue('city', place.city, touch)
      setValue('state', place.state, touch)
      setValue('country', place.country, touch)
    } catch {
      // Advisory only — the PIN is already filled in.
    }
  }

  // On open with no PIN saved, find it from the device location by itself.
  useAutoLocate(!profile.postalCode, () => void handleUseLocation(true))

  return (
    <form className={styles.form} onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate>
      {submitError && <Alert variant="error">{submitError}</Alert>}

      <TextField
        label="Address line 1"
        autoComplete="address-line1"
        error={errors.addressLine1?.message}
        {...register('addressLine1')}
      />
      <TextField
        label="Address line 2"
        autoComplete="address-line2"
        error={errors.addressLine2?.message}
        {...register('addressLine2')}
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
          <p
            className={styles.locationNote}
            role="status"
            data-variant={location.status === 'error' ? 'error' : undefined}
          >
            {location.status === 'error' && location.message
              ? location.message
              : 'Used once to find your PIN code. We don’t store your location.'}
          </p>
        </div>
      )}
      <div className={styles.row}>
        <TextField
          label="City"
          autoComplete="address-level2"
          error={errors.city?.message}
          {...register('city')}
        />
        <TextField
          label="State"
          autoComplete="address-level1"
          error={errors.state?.message}
          {...register('state')}
        />
      </div>
      <div className={styles.row}>
        <TextField
          label="Postal code"
          autoComplete="postal-code"
          error={errors.postalCode?.message}
          {...register('postalCode')}
        />
        <TextField
          label="Country"
          autoComplete="country-name"
          error={errors.country?.message}
          {...register('country')}
        />
      </div>
      <TextField
        label="Phone"
        type="tel"
        autoComplete="tel"
        error={errors.phone?.message}
        {...register('phone')}
      />

      <div className={styles.actions}>
        <Button type="submit" isLoading={isSubmitting}>
          Save changes
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
