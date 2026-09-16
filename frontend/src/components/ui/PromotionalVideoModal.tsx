import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { X, ShoppingBag } from 'lucide-react'
import styles from './PromotionalVideoModal.module.css'

export interface PromotionalVideoData {
  videoUrl?: string
  posterUrl?: string
  title?: string
  ctaText?: string
  ctaUrl?: string
}

export interface PromotionalVideoModalProps {
  isOpen: boolean
  onClose: () => void
  data: PromotionalVideoData | null
}

const DEFAULT_CTA_TEXT = 'Shop this category'

export function PromotionalVideoModal({
  isOpen,
  onClose,
  data,
}: PromotionalVideoModalProps) {
  const navigate = useNavigate()
  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const modalContentRef = useRef<HTMLDivElement>(null)
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)

  // Prevent background page scrolling while modal is open
  useEffect(() => {
    if (!isOpen) return

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = originalOverflow
      previouslyFocusedRef.current?.focus?.()
    }
  }, [isOpen, onClose])

  // Autoplay video on mount and clean up on unmount
  useEffect(() => {
    if (!isOpen || !data?.videoUrl) return

    const video = videoRef.current
    if (!video) return

    video.defaultMuted = true
    video.muted = true
    video.currentTime = 0

    const playPromise = video.play()
    if (playPromise !== undefined) {
      playPromise.catch(() => {
        // Autoplay policy prevented playback until user interaction
      })
    }

    return () => {
      if (video) {
        video.pause()
        video.currentTime = 0
      }
    }
  }, [isOpen, data?.videoUrl])

  if (!isOpen || !data) return null

  const ctaText = data.ctaText || DEFAULT_CTA_TEXT

  const handleCtaClick = () => {
    onClose()
    if (data.ctaUrl) {
      void navigate(data.ctaUrl)
    }
  }

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === overlayRef.current) {
      onClose()
    }
  }

  const modalNode = (
    <div
      className={styles.overlay}
      ref={overlayRef}
      onClick={handleOverlayClick}
      role="presentation"
    >
      <div
        className={styles.modalContent}
        ref={modalContentRef}
        role="dialog"
        aria-modal="true"
        aria-label={data.title || 'Promotional Video'}
      >
        <div className={styles.videoCard}>
          {data.title && <div className={styles.titleBadge}>{data.title}</div>}

          <button
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close video"
            type="button"
          >
            <X size={20} aria-hidden="true" />
          </button>

          {data.videoUrl ? (
            <video
              ref={videoRef}
              src={data.videoUrl}
              poster={data.posterUrl || undefined}
              playsInline
              controls
              autoPlay
              muted
              loop
              className={styles.video}
              aria-label={data.title ? `${data.title} category video` : 'Category video'}
            />
          ) : (
            <img
              src={data.posterUrl}
              alt={data.title ? `${data.title} preview` : 'Category preview'}
              className={styles.video}
            />
          )}
        </div>

        <button
          className={styles.ctaButton}
          onClick={handleCtaClick}
          type="button"
          aria-label={`${ctaText}${data.title ? ` - ${data.title}` : ''}`}
        >
          <ShoppingBag size={18} aria-hidden="true" />
          <span>{ctaText}</span>
        </button>
      </div>
    </div>
  )

  return createPortal(modalNode, document.body)
}
