import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'
import { useUpdateAdminSetting } from '@/hooks/useUpdateAdminSetting'
import { SellerIdentityStrip } from '@/layouts/SellerIdentityStrip'
import {
  SELLER_GSTIN_DEFAULT,
  SELLER_LEGAL_NAME_DEFAULT,
  SELLER_LOCALITY_DEFAULT,
  SELLER_PAYMENT_PROTECTED_DEFAULT,
} from '@/constants/sellerIdentity'
import type { AdminSettingView } from '@/services/api/settings'
import { getApiErrorMessage } from '@/utils/apiError'
import pageStyles from '../../pages/admin/AdminSettingsPage.module.css'
import styles from './NavbarSellerSettings.module.css'

const KEYS = [
  'sellerLegalName',
  'sellerLocality',
  'sellerGstin',
  'sellerPaymentProtected',
] as const

type SellerKey = (typeof KEYS)[number]

const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/

const formSchema = z.object({
  sellerLegalName: z.string().max(200, 'Too long'),
  sellerLocality: z.string().max(500, 'Too long'),
  sellerGstin: z
    .string()
    .trim()
    .refine((value) => {
      const upper = value.toUpperCase()
      return upper === '' || GSTIN_PATTERN.test(upper)
    }, 'GSTIN must be 15 characters in the standard format'),
  sellerPaymentProtected: z.boolean(),
})

type FormValues = z.infer<typeof formSchema>

interface NavbarSellerSettingsProps {
  settings: AdminSettingView[]
}

function valueFor(settings: AdminSettingView[], key: SellerKey): string {
  return settings.find((setting) => setting.key === key)?.value ?? ''
}

function toFormValues(settings: AdminSettingView[]): FormValues {
  return {
    sellerLegalName: valueFor(settings, 'sellerLegalName'),
    sellerLocality: valueFor(settings, 'sellerLocality'),
    sellerGstin: valueFor(settings, 'sellerGstin'),
    sellerPaymentProtected: valueFor(settings, 'sellerPaymentProtected') === 'true',
  }
}

function payloadFor(key: SellerKey, values: FormValues): string {
  if (key === 'sellerPaymentProtected') return values.sellerPaymentProtected ? 'true' : 'false'
  if (key === 'sellerGstin') return values.sellerGstin.trim().toUpperCase()
  return values[key].trim()
}

const NAVBAR_SELLER_SETTING_FALLBACKS: AdminSettingView[] = [
  {
    key: 'sellerLegalName',
    label: 'Legal name',
    description: 'Registered business name on the storefront navbar strip.',
    kind: 'text',
    value: SELLER_LEGAL_NAME_DEFAULT,
    default: SELLER_LEGAL_NAME_DEFAULT,
  },
  {
    key: 'sellerLocality',
    label: 'Location',
    description: 'City / locality shown next to the pin on the navbar.',
    kind: 'text',
    value: SELLER_LOCALITY_DEFAULT,
    default: SELLER_LOCALITY_DEFAULT,
  },
  {
    key: 'sellerGstin',
    label: 'GSTIN',
    description: 'GST identification number shown on the navbar.',
    kind: 'text',
    value: SELLER_GSTIN_DEFAULT,
    default: SELLER_GSTIN_DEFAULT,
  },
  {
    key: 'sellerPaymentProtected',
    label: 'Show Payment Protected',
    description: 'When true, the navbar shows a Payment Protected mark.',
    kind: 'boolean',
    value: SELLER_PAYMENT_PROTECTED_DEFAULT ? 'true' : 'false',
    default: SELLER_PAYMENT_PROTECTED_DEFAULT ? 'true' : 'false',
  },
]

/** Keep the navbar seller editor on the page even if GET /admin/settings is
 * an older API that does not list these keys yet. */
export function withNavbarSellerSettings(
  settings: AdminSettingView[],
): AdminSettingView[] {
  const present = new Set(settings.map((setting) => setting.key))
  const missing = NAVBAR_SELLER_SETTING_FALLBACKS.filter(
    (setting) => !present.has(setting.key),
  )
  return missing.length === 0 ? settings : [...settings, ...missing]
}

export function NavbarSellerSettings({ settings }: NavbarSellerSettingsProps) {
  const updateSetting = useUpdateAdminSetting()
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: toFormValues(settings),
  })

  const preview = watch()
  const legalName = valueFor(settings, 'sellerLegalName')
  const locality = valueFor(settings, 'sellerLocality')
  const gstin = valueFor(settings, 'sellerGstin')
  const payment = valueFor(settings, 'sellerPaymentProtected')

  useEffect(() => {
    reset({
      sellerLegalName: legalName,
      sellerLocality: locality,
      sellerGstin: gstin,
      sellerPaymentProtected: payment === 'true',
    })
  }, [legalName, locality, gstin, payment, reset])

  async function onSubmit(values: FormValues) {
    const current = toFormValues(settings)
    updateSetting.reset()
    try {
      for (const key of KEYS) {
        const next = payloadFor(key, values)
        const previous = payloadFor(key, current)
        if (next === previous) continue
        await updateSetting.mutateAsync({ key, value: next })
      }
      reset({
        ...values,
        sellerLegalName: values.sellerLegalName.trim(),
        sellerLocality: values.sellerLocality.trim(),
        sellerGstin: values.sellerGstin.trim().toUpperCase(),
      })
    } catch {
      // Surfaced via updateSetting.isError.
    }
  }

  return (
    <form className={styles.form} onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate>
      <p className={pageStyles.help}>
        This is the strip under the store logo. Save here to change the name, location, GSTIN, and
        Payment Protected mark customers see.
      </p>

      <div className={styles.previewBlock}>
        <p className={styles.previewCaption}>Navbar preview</p>
        {preview.sellerLegalName.trim() ||
        preview.sellerLocality.trim() ||
        preview.sellerGstin.trim() ||
        preview.sellerPaymentProtected ? (
          <SellerIdentityStrip
            compact
            legalName={preview.sellerLegalName.trim()}
            locality={preview.sellerLocality.trim()}
            gstin={preview.sellerGstin.trim().toUpperCase()}
            paymentProtected={preview.sellerPaymentProtected}
          />
        ) : (
          <p className={styles.emptyPreview}>The navbar strip will be hidden.</p>
        )}
      </div>

      <TextField
        label="Legal name"
        id="navbar-seller-legal-name"
        error={errors.sellerLegalName?.message}
        {...register('sellerLegalName')}
      />
      <TextField
        label="Location"
        id="navbar-seller-locality"
        error={errors.sellerLocality?.message}
        {...register('sellerLocality')}
      />
      <TextField
        label="GSTIN"
        id="navbar-seller-gstin"
        autoCapitalize="characters"
        spellCheck={false}
        error={errors.sellerGstin?.message}
        {...register('sellerGstin')}
      />
      <label className={styles.checkboxLabel}>
        <input type="checkbox" {...register('sellerPaymentProtected')} />
        <span>
          <span className={styles.checkboxTitle}>Show Payment Protected</span>
          <span className={styles.checkboxHelp}>
            Green badge on the right of the strip. Turn off to hide it.
          </span>
        </span>
      </label>

      {updateSetting.isError && (
        <Alert variant="error">{getApiErrorMessage(updateSetting.error)}</Alert>
      )}
      {updateSetting.isSuccess && !isDirty && !updateSetting.isPending && (
        <Alert variant="success">Saved. The storefront navbar will use these values.</Alert>
      )}

      <div className={pageStyles.actions}>
        <Button
          type="submit"
          isLoading={updateSetting.isPending}
          disabled={updateSetting.isPending || !isDirty}
        >
          Save navbar strip
        </Button>
      </div>
    </form>
  )
}
