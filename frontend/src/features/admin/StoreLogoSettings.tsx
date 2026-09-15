import { useRef, useState } from 'react'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { useUpdateAdminSetting } from '@/hooks/useUpdateAdminSetting'
import { useUploadFile } from '@/hooks/useUploadFile'
import { STORE_LOGO_FALLBACK } from '@/hooks/useStoreLogo'
import type { AdminSettingView } from '@/services/api/settings'
import { getApiErrorMessage } from '@/utils/apiError'
import styles from '../../pages/admin/AdminSettingsPage.module.css'

const LOGO_ACCEPT = 'image/png,image/jpeg'

interface StoreLogoSettingsProps {
  setting: AdminSettingView
}

export function StoreLogoSettings({ setting }: StoreLogoSettingsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadFile = useUploadFile()
  const updateSetting = useUpdateAdminSetting()
  const [error, setError] = useState<string | null>(null)

  const currentSrc = setting.value.trim() || setting.default || STORE_LOGO_FALLBACK
  const isDefault = currentSrc === (setting.default || STORE_LOGO_FALLBACK)
  const busy = uploadFile.isPending || updateSetting.isPending

  async function saveLogo(url: string) {
    setError(null)
    try {
      await updateSetting.mutateAsync({ key: 'storeLogo', value: url })
    } catch (err) {
      setError(getApiErrorMessage(err))
    }
  }

  async function handleFileSelected(file: File) {
    setError(null)
    if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
      setError('Upload a PNG or JPEG logo.')
      return
    }
    try {
      const uploaded = await uploadFile.mutateAsync(file)
      await saveLogo(uploaded.url)
    } catch (err) {
      setError(getApiErrorMessage(err))
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className={styles.row}>
      <p className={styles.textareaLabel} id="store-logo-label">
        {setting.label}
      </p>
      <div className={styles.logoPreviewFrame}>
        <img src={currentSrc} alt="Current store logo" className={styles.logoPreview} />
      </div>
      <p className={styles.help}>{setting.description}</p>

      {error && <Alert variant="error">{error}</Alert>}
      {updateSetting.isSuccess && !busy && !error && (
        <Alert variant="success">Logo saved. The navbar will use this image.</Alert>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={LOGO_ACCEPT}
        className={styles.hiddenInput}
        aria-labelledby="store-logo-label"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void handleFileSelected(file)
        }}
      />

      <div className={styles.logoActions}>
        <Button
          type="button"
          isLoading={busy}
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
        >
          Upload logo
        </Button>
        {!isDefault && (
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => void saveLogo(setting.default || STORE_LOGO_FALLBACK)}
          >
            Use default logo
          </Button>
        )}
      </div>
    </div>
  )
}
