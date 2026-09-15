import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Upload } from 'lucide-react'
import type { CustomizationField } from '@/types/catalog'
import { useUploadFile } from '@/hooks/useUploadFile'
import { getApiErrorMessage } from '@/utils/apiError'
import { RequiredMark } from '@/components/ui/RequiredMark'
import styles from './FileUploadField.module.css'

function pickerLabel(type: CustomizationField['type']): string {
  switch (type) {
    case 'IMAGE_UPLOAD':
      return 'Upload photo'
    case 'LOGO_UPLOAD':
      return 'Upload logo'
    case 'DESIGN_FILE_UPLOAD':
      return 'Upload artwork'
    default:
      return 'Upload file'
  }
}

interface FieldConstraints {
  allowedFormats?: string[]
  maxFileSizeMb?: number
}

interface FileUploadFieldProps {
  field: CustomizationField
  value: string
  onChange: (uploadedFileId: string) => void
  error?: string
}

/** What the selected-file card needs from the picked File (UX-22). */
interface SelectedFile {
  name: string
  size: number
  /** Uppercased extension, for the badge + the metadata line. */
  ext: string
  /** Whether an inline image thumbnail is appropriate for this file. */
  isImage: boolean
  /** data: URL for the <img> thumbnail once FileReader has produced it
   * (null until then, and for non-image files). A data: URL — not a blob:
   * object URL — because the app CSP allows `img-src data:` but not
   * `blob:`, and a data URL needs no revoke lifecycle. */
  previewUrl: string | null
}

/**
 * Extension, not MIME type — matches the allowedFormats values used
 * throughout prisma/seed-production.ts ('png', 'jpeg', 'pdf'). This is a
 * client-side pre-check for fast feedback only; the server's magic-byte
 * signature check (uploads.service.ts, §24) is the real gate and doesn't
 * trust the extension either.
 */
function getExtension(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() ?? ''
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * One customization field of type LOGO_UPLOAD/IMAGE_UPLOAD/
 * DESIGN_FILE_UPLOAD. Uploads eagerly on file selection (POST /uploads —
 * the same shared endpoint product-image upload uses) rather than
 * deferring to form submit: this field's form value IS the resulting
 * uploadedFileId (cart/dto/customization-value.dto.ts), so there's
 * nothing else to submit once the upload finishes.
 *
 * UX-22: as soon as a valid file is picked we show a selected-file card —
 * a local image thumbnail (read with FileReader, never a server round
 * trip) for images, otherwise an extension badge — with the filename,
 * type + size, upload state, and Change / Remove actions. None of this
 * changes when or how the server receives the file.
 */
export function FileUploadField({ field, value, onChange, error }: FileUploadFieldProps) {
  const constraints = (field.constraints ?? {}) as FieldConstraints
  const inputRef = useRef<HTMLInputElement>(null)
  const readerRef = useRef<FileReader | null>(null)
  // Bumped on every selection so a slow FileReader for a replaced file
  // can't write its result over the current one.
  const readTokenRef = useRef(0)
  const [selected, setSelected] = useState<SelectedFile | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const upload = useUploadFile()

  useEffect(() => {
    return () => {
      readerRef.current?.abort()
    }
  }, [])

  function clearSelection() {
    readTokenRef.current += 1
    readerRef.current?.abort()
    readerRef.current = null
    setSelected(null)
  }

  function validateLocally(file: File): string | null {
    if (constraints.allowedFormats?.length) {
      const extension = getExtension(file.name)
      if (!constraints.allowedFormats.includes(extension)) {
        return `${field.label} must be one of: ${constraints.allowedFormats.join(', ')}`
      }
    }
    if (constraints.maxFileSizeMb !== undefined) {
      const maxBytes = constraints.maxFileSizeMb * 1024 * 1024
      if (file.size > maxBytes) {
        return `${field.label} must be at most ${constraints.maxFileSizeMb}MB`
      }
    }
    return null
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    const validationError = validateLocally(file)
    if (validationError) {
      setLocalError(validationError)
      clearSelection()
      onChange('')
      event.target.value = ''
      return
    }

    setLocalError(null)
    readTokenRef.current += 1
    readerRef.current?.abort()
    const token = readTokenRef.current
    const isImage = file.type.startsWith('image/')

    setSelected({
      name: file.name,
      size: file.size,
      ext: getExtension(file.name).toUpperCase(),
      isImage,
      previewUrl: null,
    })

    if (isImage) {
      const reader = new FileReader()
      readerRef.current = reader
      reader.onload = () => {
        if (readTokenRef.current !== token) return
        const result = typeof reader.result === 'string' ? reader.result : null
        setSelected((prev) => (prev ? { ...prev, previewUrl: result } : prev))
      }
      reader.readAsDataURL(file)
    }

    upload.mutate(file, {
      onSuccess: (uploaded) => onChange(uploaded.id),
      onError: () => {
        onChange('')
        clearSelection()
      },
    })
  }

  function handleRemove() {
    setLocalError(null)
    clearSelection()
    onChange('')
    if (inputRef.current) {
      inputRef.current.value = ''
    }
  }

  function handleChange() {
    inputRef.current?.click()
  }

  // localError (client-side format/size pre-check) takes priority over
  // error (RHF/zod, e.g. "required") — once a rejected file clears the
  // field back to blank, the required error would otherwise mask the
  // more specific reason the file was rejected in the first place.
  const displayError =
    localError ?? error ?? (upload.isError ? getApiErrorMessage(upload.error) : undefined)

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={field.id}>
        {field.label}
        {field.isRequired && <RequiredMark />}
      </label>
      {field.helpText && <p className={styles.helpText}>{field.helpText}</p>}

      {/* Native picker stays in the tree (visually hidden) so the field
          label and Change action can open it. The visible control is the
          styled button below. */}
      <input
        ref={inputRef}
        id={field.id}
        type="file"
        accept={constraints.allowedFormats?.map((format) => `.${format}`).join(',')}
        onChange={handleFileChange}
        disabled={upload.isPending}
        aria-invalid={Boolean(displayError)}
        aria-required={field.isRequired || undefined}
        className="srOnly"
      />

      {!selected && (
        <button
          type="button"
          className={styles.picker}
          onClick={handleChange}
          disabled={upload.isPending}
          aria-invalid={Boolean(displayError) || undefined}
        >
          <Upload size={18} strokeWidth={2} aria-hidden="true" />
          {pickerLabel(field.type)}
        </button>
      )}

      {selected && (
        <div className={styles.preview}>
          {selected.previewUrl ? (
            <img
              src={selected.previewUrl}
              alt={`Preview of ${selected.name}`}
              className={styles.thumb}
            />
          ) : (
            <span className={styles.fileBadge} aria-hidden="true">
              {selected.ext || 'FILE'}
            </span>
          )}

          <div className={styles.meta}>
            <span className={styles.fileName} title={selected.name}>
              {selected.name}
            </span>
            <span className={styles.fileMeta}>
              {selected.ext || 'File'} · {formatFileSize(selected.size)}
            </span>
            <span className={styles.status} role="status">
              {upload.isPending || !value ? 'Uploading…' : 'Uploaded'}
            </span>
          </div>

          <div className={styles.actions}>
            {!upload.isPending && (
              <button
                type="button"
                className={styles.actionButton}
                onClick={handleChange}
              >
                Change
              </button>
            )}
            <button
              type="button"
              className={styles.actionButton}
              onClick={handleRemove}
            >
              Remove
            </button>
          </div>
        </div>
      )}

      {displayError && (
        <p className={styles.error} role="alert">
          {displayError}
        </p>
      )}
    </div>
  )
}
