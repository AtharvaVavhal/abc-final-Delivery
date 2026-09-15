import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react'
import { cn } from '@/utils/cn'
import { Button } from '@/components/ui/Button'
import type { HeroSlide } from '@/services/api/settings'
import { isVideoUrl } from '@/features/media/mediaAsset'
import { DeferredVideo } from '@/components/media/DeferredVideo'
import { useWhatsappNumber } from '@/hooks/useWhatsappNumber'
import styles from './HeroCarousel.module.css'

const AUTOPLAY_MS = 8000

interface HeroCarouselProps {
  slides: HeroSlide[]
}

export function HeroCarousel({ slides }: HeroCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(true)
  const [hoverPaused, setHoverPaused] = useState(false)
  const carouselRef = useRef<HTMLElement>(null)
  const whatsapp = useWhatsappNumber()

  const slideCount = slides.length

  const goToSlide = useCallback((index: number) => {
    setCurrentIndex((prev) => (index + prev + slideCount) % slideCount)
  }, [slideCount])

  const nextSlide = useCallback(() => goToSlide(1), [goToSlide])
  const prevSlide = useCallback(() => goToSlide(-1), [goToSlide])

  useEffect(() => {
    if (!isPlaying || hoverPaused || slideCount <= 1) return
    const timer = setInterval(nextSlide, AUTOPLAY_MS)
    return () => clearInterval(timer)
  }, [isPlaying, hoverPaused, slideCount, nextSlide])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return

    const root = carouselRef.current
    const target = e.target as HTMLElement | null
    if (!root || !target || !root.contains(target)) return
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return

    if (e.key === 'ArrowRight') {
      nextSlide()
    } else {
      prevSlide()
    }
  }, [nextSlide, prevSlide])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  if (!slides.length) return null

  const whatsappHref = whatsapp
    ? `https://wa.me/${whatsapp}?text=${encodeURIComponent('Hi! I want to order a personalised gift.')}`
    : ''

  return (
    <section
      ref={carouselRef}
      className={styles.carousel}
      aria-label="Hero carousel"
      onMouseEnter={() => setHoverPaused(true)}
      onMouseLeave={() => setHoverPaused(false)}
    >
      <div className={styles.track} role="list">
        {slides.map((slide, index) => (
          <div
            key={index}
            className={cn(styles.slide, index === currentIndex && styles.active)}
            role="listitem"
            aria-hidden={index !== currentIndex}
          >
            {slide.imageUrl &&
              (isVideoUrl(slide.imageUrl) ? (
                <DeferredVideo
                  src={slide.imageUrl}
                  label={slide.headline}
                  className={styles.image}
                />
              ) : (
                <img
                  src={slide.imageUrl}
                  alt={index === currentIndex ? slide.headline : ''}
                  className={styles.image}
                  loading={index === currentIndex ? 'eager' : 'lazy'}
                />
              ))}
            <div className={styles.scrim} aria-hidden="true" />
            <div className={styles.content}>
              {index === currentIndex ? (
                <h1 className={styles.headline}>{slide.headline}</h1>
              ) : (
                <p className={styles.headline}>{slide.headline}</p>
              )}
              <p className={styles.subtext}>{slide.subtext}</p>
              <div className={styles.actions}>
                <Link to={slide.ctaLink} className={styles.ctaWrapper}>
                  <Button>{slide.ctaText}</Button>
                </Link>
                {whatsappHref ? (
                  <a
                    href={whatsappHref}
                    className={styles.whatsappCta}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Chat on WhatsApp
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>

      {slideCount > 1 && (
        <>
          <button
            className={cn(styles.navBtn, styles.prev)}
            onClick={prevSlide}
            aria-label="Previous slide"
            type="button"
          >
            <ChevronLeft size={28} aria-hidden="true" />
          </button>
          <button
            className={cn(styles.navBtn, styles.next)}
            onClick={nextSlide}
            aria-label="Next slide"
            type="button"
          >
            <ChevronRight size={28} aria-hidden="true" />
          </button>

          <div className={styles.pagination} aria-label="Slide navigation">
            {slides.map((_, index) => (
              <button
                key={index}
                type="button"
                className={cn(styles.dot, index === currentIndex && styles.active)}
                onClick={() => setCurrentIndex(index)}
                aria-label={`Go to slide ${index + 1}`}
                aria-current={index === currentIndex ? 'true' : undefined}
              />
            ))}
          </div>

          <button
            className={styles.playPause}
            onClick={() => setIsPlaying((p) => !p)}
            aria-label={isPlaying ? 'Pause carousel' : 'Play carousel'}
            aria-pressed={isPlaying}
            type="button"
          >
            {isPlaying ? <Pause size={20} aria-hidden="true" /> : <Play size={20} aria-hidden="true" />}
          </button>
        </>
      )}
    </section>
  )
}
