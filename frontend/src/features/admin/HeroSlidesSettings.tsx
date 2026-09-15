import { useEffect, useRef, useState } from 'react'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { TextField } from '@/components/ui/TextField'
import { AdminEmptyState } from '@/components/admin/AdminEmptyState'
import { useUpdateAdminSetting } from '@/hooks/useUpdateAdminSetting'
import { useUploadFile } from '@/hooks/useUploadFile'
import type { AdminSettingView, HeroSlide } from '@/services/api/settings'
import { getApiErrorMessage } from '@/utils/apiError'
import styles from '../../pages/admin/AdminSettingsPage.module.css'

const IMAGE_ACCEPT = 'image/png,image/jpeg'
const MAX_HERO_SLIDES = 8

const EMPTY_SLIDE: HeroSlide = {
  imageUrl: '',
  headline: '',
  subtext: '',
  ctaText: '',
  ctaLink: '',
}

export function parseHeroSlides(raw: string): HeroSlide[] {
  const trimmed = raw.trim()
  if (!trimmed) return []
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return { ...EMPTY_SLIDE }
      const record = item as Record<string, unknown>
      return {
        imageUrl: typeof record.imageUrl === 'string' ? record.imageUrl : '',
        headline: typeof record.headline === 'string' ? record.headline : '',
        subtext: typeof record.subtext === 'string' ? record.subtext : '',
        ctaText: typeof record.ctaText === 'string' ? record.ctaText : '',
        ctaLink: typeof record.ctaLink === 'string' ? record.ctaLink : '',
      }
    })
  } catch {
    return []
  }
}

interface HeroSlidesSettingsProps {
  setting: AdminSettingView
}

export function HeroSlidesSettings({ setting }: HeroSlidesSettingsProps) {
  const addInputRef = useRef<HTMLInputElement>(null)
  const replaceInputRef = useRef<HTMLInputElement>(null)
  const replaceIndexRef = useRef<number | null>(null)
  const uploadFile = useUploadFile()
  const updateSetting = useUpdateAdminSetting()
  const [slides, setSlides] = useState<HeroSlide[]>(() => parseHeroSlides(setting.value))
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<number | null>(null)

  useEffect(() => {
    setSlides(parseHeroSlides(setting.value))
  }, [setting.value])

  const isDirty =
    JSON.stringify(slides) !== JSON.stringify(parseHeroSlides(setting.value))
  const busy = uploadFile.isPending || updateSetting.isPending
  const atLimit = slides.length >= MAX_HERO_SLIDES

  async function persist(next: HeroSlide[]) {
    setError(null)
    setSaved(false)
    try {
      const updated = await updateSetting.mutateAsync({
        key: 'hero_slides',
        value: next.length === 0 ? '' : JSON.stringify(next),
      })
      setSlides(parseHeroSlides(updated.value))
      setSaved(true)
    } catch (err) {
      setError(getApiErrorMessage(err))
    }
  }

  async function handleImageFile(file: File, mode: 'add' | 'replace') {
    setError(null)
    setSaved(false)
    if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
      setError('Upload a PNG or JPEG hero image.')
      return
    }
    try {
      const uploaded = await uploadFile.mutateAsync(file)
      if (mode === 'add') {
        if (slides.length >= MAX_HERO_SLIDES) {
          setError(`Hero cannot have more than ${MAX_HERO_SLIDES} slides.`)
          return
        }
        setSlides((current) => [
          ...current,
          { ...EMPTY_SLIDE, imageUrl: uploaded.url, headline: 'New slide' },
        ])
      } else {
        const index = replaceIndexRef.current
        if (index === null) return
        setSlides((current) =>
          current.map((slide, i) => (i === index ? { ...slide, imageUrl: uploaded.url } : slide)),
        )
      }
    } catch (err) {
      setError(getApiErrorMessage(err))
    } finally {
      replaceIndexRef.current = null
      if (addInputRef.current) addInputRef.current.value = ''
      if (replaceInputRef.current) replaceInputRef.current.value = ''
    }
  }

  function updateSlide(index: number, patch: Partial<HeroSlide>) {
    setSaved(false)
    setSlides((current) => current.map((slide, i) => (i === index ? { ...slide, ...patch } : slide)))
  }

  function confirmDelete() {
    if (pendingDelete === null) return
    setSaved(false)
    setSlides((current) => current.filter((_, i) => i !== pendingDelete))
    setPendingDelete(null)
  }

  return (
    <div className={`${styles.row} ${styles.heroEditor}`}>
      <p className={styles.textareaLabel}>{setting.label}</p>
      <p className={styles.help}>{setting.description}</p>

      {slides.length === 0 ? (
        <AdminEmptyState
          title="No hero slides yet"
          description="Upload a PNG or JPEG to add the first homepage banner. Until then the site uses the built-in fallback hero."
        />
      ) : (
        <ul className={styles.heroList}>
          {slides.map((slide, index) => (
            <li key={`${slide.imageUrl}-${index}`} className={styles.heroCard}>
              <div className={styles.heroThumbWrap}>
                {slide.imageUrl ? (
                  <img src={slide.imageUrl} alt={`Slide ${index + 1} image`} className={styles.heroThumb} />
                ) : (
                  <div className={styles.heroThumbFallback}>No image</div>
                )}
              </div>
              <div className={styles.heroFields}>
                <TextField
                  id={`hero-slide-${index}-headline`}
                  label={`Slide ${index + 1} headline`}
                  value={slide.headline}
                  onChange={(event) => updateSlide(index, { headline: event.target.value })}
                />
                <TextField
                  id={`hero-slide-${index}-subtext`}
                  label={`Slide ${index + 1} subtext`}
                  value={slide.subtext}
                  onChange={(event) => updateSlide(index, { subtext: event.target.value })}
                />
                <TextField
                  id={`hero-slide-${index}-cta-text`}
                  label={`Slide ${index + 1} button text`}
                  value={slide.ctaText}
                  onChange={(event) => updateSlide(index, { ctaText: event.target.value })}
                />
                <TextField
                  id={`hero-slide-${index}-cta-link`}
                  label={`Slide ${index + 1} button link`}
                  value={slide.ctaLink}
                  onChange={(event) => updateSlide(index, { ctaLink: event.target.value })}
                />
                <div className={styles.logoActions}>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      replaceIndexRef.current = index
                      replaceInputRef.current?.click()
                    }}
                  >
                    Replace image
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => setPendingDelete(index)}
                  >
                    Delete slide
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && <Alert variant="error">{error}</Alert>}
      {saved && !error && (
        <Alert variant="success">Hero slides saved. The homepage will use this set.</Alert>
      )}

      <input
        ref={addInputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        className={styles.hiddenInput}
        aria-label="Add hero image"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void handleImageFile(file, 'add')
        }}
      />
      <input
        ref={replaceInputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        className={styles.hiddenInput}
        aria-label="Replace hero image"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void handleImageFile(file, 'replace')
        }}
      />

      <div className={styles.logoActions}>
        <Button
          type="button"
          variant="secondary"
          disabled={busy || atLimit}
          onClick={() => addInputRef.current?.click()}
        >
          Add slide
        </Button>
        <Button
          type="button"
          isLoading={updateSetting.isPending}
          disabled={busy || !isDirty}
          onClick={() => void persist(slides)}
        >
          Save slides
        </Button>
      </div>

      <Modal
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete this slide?"
        size="sm"
      >
        <p className={styles.help}>
          This removes the slide from the homepage hero. Save slides afterwards to publish the
          change.
        </p>
        <div className={styles.logoActions}>
          <Button type="button" variant="secondary" onClick={() => setPendingDelete(null)}>
            Keep slide
          </Button>
          <Button type="button" onClick={confirmDelete}>
            Delete slide
          </Button>
        </div>
      </Modal>
    </div>
  )
}
