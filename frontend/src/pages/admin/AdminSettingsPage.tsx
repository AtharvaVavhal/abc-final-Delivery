import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useAdminSettings } from '@/hooks/useAdminSettings'
import { useUpdateAdminSetting } from '@/hooks/useUpdateAdminSetting'
import { schemaForKind } from '@/schemas/adminSettings.schema'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'
import { AdminPage } from '@/components/admin/AdminPage'
import { AdminCard } from '@/components/admin/AdminCard'
import { AdminSelect } from '@/components/admin/AdminSelect'
import { AdminPageSkeleton } from '@/components/admin/AdminPageSkeleton'
import { getApiErrorMessage } from '@/utils/apiError'
import type { AdminSettingView } from '@/services/api/settings'
import { PaymentAccountSettings } from '@/features/admin/PaymentAccountSettings'
import { StoreLogoSettings } from '@/features/admin/StoreLogoSettings'
import { HeroSlidesSettings } from '@/features/admin/HeroSlidesSettings'
import { NavbarSellerSettings, withNavbarSellerSettings } from '@/features/admin/NavbarSellerSettings'
import styles from './AdminSettingsPage.module.css'

/** Client-side presentation grouping only — derived from the setting
 * `key` prefixes the backend already uses (`tax.*`, `invoice.*`). It
 * adds no configuration and changes no value. */
const STORE_IDENTITY_KEYS = ['storeName', 'storeAdminName', 'storeLogo']
const STORE_CONTACT_KEYS = [
  'whatsappNumber',
  'storeContactEmail',
  'storeContactPhone',
  'storeAddress',
]
const NAVBAR_SELLER_KEYS = [
  'sellerLegalName',
  'sellerLocality',
  'sellerGstin',
  'sellerPaymentProtected',
]
const STOREFRONT_CONTENT_KEYS = [
  'announcement_text',
  'hero_slides',
  'brand_story',
  'featured_media',
]

const GROUPS: { title: string; belongs: (key: string) => boolean }[] = [
  { title: 'Store identity', belongs: (k) => STORE_IDENTITY_KEYS.includes(k) },
  {
    title: 'Storefront contact',
    belongs: (k) => STORE_CONTACT_KEYS.includes(k),
  },
  {
    title: 'Navbar seller identity',
    belongs: (k) => NAVBAR_SELLER_KEYS.includes(k),
  },
  {
    title: 'Storefront content',
    belongs: (k) => STOREFRONT_CONTENT_KEYS.includes(k),
  },
  {
    title: 'Storefront',
    belongs: (k) =>
      !STORE_IDENTITY_KEYS.includes(k) &&
      !STORE_CONTACT_KEYS.includes(k) &&
      !NAVBAR_SELLER_KEYS.includes(k) &&
      !STOREFRONT_CONTENT_KEYS.includes(k) &&
      !k.startsWith('tax.') &&
      !k.startsWith('invoice.'),
  },
  { title: 'Tax (GST)', belongs: (k) => k.startsWith('tax.') },
  { title: 'Invoicing', belongs: (k) => k.startsWith('invoice.') },
]

function groupSettings(settings: AdminSettingView[]) {
  return GROUPS.map((group) => ({
    title: group.title,
    settings: settings.filter((s) => group.belongs(s.key)),
  })).filter((group) => group.settings.length > 0)
}

/**
 * Behind AdminRoute (App.tsx). One small form per configurable setting
 * (GET /admin/settings), grouped into cards by key prefix. Every value is
 * re-validated server-side; a "Saved" confirmation only ever appears after
 * the PATCH actually resolves — no optimistic success.
 *
 * Settings flagged `pendingClientInput` (GST rate, invoice prefix, seller
 * legal name / address / GSTIN / state) ship blank and carry a "pending
 * client confirmation" notice. Tax pricing mode's option list comes
 * straight from the API — EXCLUSIVE is locked server-side and simply not
 * offered.
 *
 * Homepage banners / showcase categories are still settings-backed but not
 * exposed here (they need their own structured editors). Hero slides are
 * editable below.
 */
export function AdminSettingsPage() {
  const settingsQuery = useAdminSettings()

  if (settingsQuery.isPending) {
    return <AdminPageSkeleton rows={4} />
  }

  const groups = settingsQuery.data
    ? groupSettings(withNavbarSellerSettings(settingsQuery.data))
    : []

  return (
    <AdminPage
      title="Store settings"
      description="These values take effect immediately across the storefront and checkout. The server validates and is the source of truth for every one."
    >
      {settingsQuery.isError && (
        <Alert variant="error">{getApiErrorMessage(settingsQuery.error)}</Alert>
      )}

      {groups.map((group) => (
        <AdminCard key={group.title} as="section" title={group.title}>
          <div className={styles.group}>
            {group.title === 'Navbar seller identity' ? (
              <NavbarSellerSettings settings={group.settings} />
            ) : (
              group.settings.map((setting) =>
                setting.key === 'storeLogo' ? (
                  <StoreLogoSettings key={setting.key} setting={setting} />
                ) : setting.key === 'hero_slides' ? (
                  <HeroSlidesSettings key={setting.key} setting={setting} />
                ) : (
                  <SettingRow key={setting.key} setting={setting} />
                ),
              )
            )}
          </div>
        </AdminCard>
      ))}

      <AdminCard as="section" title="Payments">
        <PaymentAccountSettings />
      </AdminCard>
    </AdminPage>
  )
}

interface SettingRowProps {
  setting: AdminSettingView
}

function SettingRow({ setting }: SettingRowProps) {
  const updateSetting = useUpdateAdminSetting()
  const [savedValue, setSavedValue] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<{ value: string }>({
    resolver: zodResolver(schemaForKind(setting.kind, setting.key)),
    defaultValues: { value: setting.value },
  })

  // Keep the field in sync if the server value changes underneath us
  // (e.g. another admin saved, cache refetched).
  useEffect(() => {
    reset({ value: setting.value })
  }, [setting.value, reset])

  async function onSubmit(values: { value: string }) {
    setSavedValue(null)
    try {
      const updated = await updateSetting.mutateAsync({
        key: setting.key,
        value: values.value,
      })
      reset({ value: updated.value })
      setSavedValue(updated.value)
    } catch {
      // Surfaced via updateSetting.isError below.
    }
  }

  const fieldId = `setting-${setting.key}`
  const isChoice = setting.kind === 'boolean' || setting.kind === 'enum'
  const isLongText =
    setting.key === 'brand_story' ||
    setting.key === 'featured_media' ||
    setting.key === 'storeAddress'
  const choiceOptions =
    setting.kind === 'boolean' ? ['false', 'true'] : (setting.options ?? [])

  return (
    <form className={styles.row} onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate>
      {isChoice ? (
        <AdminSelect
          label={setting.label}
          id={fieldId}
          error={errors.value?.message}
          {...register('value')}
        >
          {choiceOptions.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </AdminSelect>
      ) : isLongText ? (
        <div>
          <label htmlFor={fieldId} className={styles.textareaLabel}>
            {setting.label}
          </label>
          <textarea
            id={fieldId}
            className={styles.textarea}
            rows={6}
            aria-invalid={Boolean(errors.value?.message)}
            {...register('value')}
          />
          {errors.value?.message ? (
            <p className={styles.help} role="alert">
              {errors.value.message}
            </p>
          ) : null}
        </div>
      ) : (
        <TextField
          label={setting.label}
          id={fieldId}
          inputMode={
            setting.kind === 'money' || setting.kind === 'percent' ? 'decimal' : undefined
          }
          error={errors.value?.message}
          {...register('value')}
        />
      )}

      <p className={styles.help}>{setting.description}</p>

      {setting.pendingClientInput && (
        <Alert variant="info">
          Pending client confirmation — leave blank until the client/accountant supplies this
          value. It is never guessed.
        </Alert>
      )}

      {updateSetting.isError && (
        <Alert variant="error">{getApiErrorMessage(updateSetting.error)}</Alert>
      )}
      {savedValue !== null && !isDirty && (
        <Alert variant="success">
          Saved.{' '}
          {savedValue === ''
            ? 'The value is now blank.'
            : `The value is now “${savedValue}”.`}
        </Alert>
      )}

      <div className={styles.actions}>
        <Button
          type="submit"
          isLoading={updateSetting.isPending}
          disabled={updateSetting.isPending || !isDirty}
        >
          Save
        </Button>
      </div>
    </form>
  )
}
