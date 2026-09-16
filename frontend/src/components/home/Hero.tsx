import { useCallback, useEffect, useRef, useState } from 'react'
import type { FocusEvent, MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react'
import { cn } from '@/utils/cn'
import {
  HERO_LCP_INTRINSIC_HEIGHT,
  HERO_LCP_INTRINSIC_WIDTH,
  HERO_LCP_SIZES,
  HERO_PRELOAD_WIDTH,
  heroFallbackSrc,
  heroSrcSet,
  localHeroBasename,
  optimizedHeroUrl,
} from '@/features/media/heroLcpImage'
import { useDeferUntilIdle } from '@/hooks/useDeferUntilIdle'
import styles from './Hero.module.css'

export interface HeroSlide {
  id: string
  image: string
  alt: string
  eyebrow: string
  headline: string
  subtext: string
  ctaText: string
  ctaLink: string
  secondaryText?: string
  secondaryLink?: string
}

const AUTOPLAY_MS = 6500

function HeroSlideImage({
  url,
  alt,
  className,
  style,
  lcp,
}: {
  url: string
  alt: string
  className?: string
  style?: { animationDuration?: string }
  lcp: boolean
}) {
  const loading = lcp ? 'eager' : 'lazy'
  const fetchPriority = lcp ? 'high' : 'low'
  const img = (
    <img
      src={heroFallbackSrc(url)}
      srcSet={heroSrcSet(url, 'jpg')}
      sizes={HERO_LCP_SIZES}
      width={HERO_LCP_INTRINSIC_WIDTH}
      height={HERO_LCP_INTRINSIC_HEIGHT}
      alt={alt}
      className={className}
      style={style}
      loading={loading}
      fetchPriority={fetchPriority}
      decoding="async"
    />
  )
  if (!localHeroBasename(url)) {
    return (
      <img
        src={optimizedHeroUrl(url, HERO_PRELOAD_WIDTH)}
        srcSet={heroSrcSet(url, 'jpg')}
        sizes={HERO_LCP_SIZES}
        width={HERO_LCP_INTRINSIC_WIDTH}
        height={HERO_LCP_INTRINSIC_HEIGHT}
        alt={alt}
        className={className}
        style={style}
        loading={loading}
        fetchPriority={fetchPriority}
        decoding="async"
      />
    )
  }
  return (
    <picture>
      <source type="image/avif" srcSet={heroSrcSet(url, 'avif')} sizes={HERO_LCP_SIZES} />
      <source type="image/webp" srcSet={heroSrcSet(url, 'webp')} sizes={HERO_LCP_SIZES} />
      {img}
    </picture>
  )
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return reduced
}

/** Same stage geometry as Hero so the shell does not wait on settings. */
export function HeroFallback({ title, busy = false }: { title: string; busy?: boolean }) {
  return (
    <section className={styles.hero} aria-busy={busy || undefined}>
      {busy ? (
        <p className="srOnly" role="status">
          Loading homepage
        </p>
      ) : null}
      <div className={styles.stage} />
      <div className={styles.scrim} aria-hidden="true" />
      <div className={styles.copy}>
        <h1 id="home-hero-heading" className={styles.headline}>
          {title}
        </h1>
      </div>
    </section>
  )
}

export function Hero({ slides }: { slides?: HeroSlide[] }) {
  const resolved = slides && slides.length > 0 ? slides : []
  const slideCount = resolved.length
  const reducedMotion = usePrefersReducedMotion()
  const allowSecondary = useDeferUntilIdle()

  const [currentIndex, setCurrentIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(true)
  const [interactionPaused, setInteractionPaused] = useState(false)
  const rootRef = useRef<HTMLElement>(null)
  const currentIndexRef = useRef(currentIndex)

  const current = resolved[currentIndex] ?? resolved[0]

  const goTo = useCallback(
    (index: number) => {
      setCurrentIndex(((index % slideCount) + slideCount) % slideCount)
    },
    [slideCount],
  )
  const next = useCallback(() => goTo(currentIndex + 1), [goTo, currentIndex])
  const prev = useCallback(() => goTo(currentIndex - 1), [goTo, currentIndex])

  useEffect(() => {
    currentIndexRef.current = currentIndex
  }, [currentIndex])

  // Reads the index via ref instead of depending on currentIndex, so the
  // interval is only torn down/recreated on a pause-state change (not on
  // every slide advance).
  useEffect(() => {
    if (reducedMotion || !isPlaying || interactionPaused || slideCount <= 1) {
      return
    }
    const timer = window.setInterval(() => {
      goTo(currentIndexRef.current + 1)
    }, AUTOPLAY_MS)
    return () => {
      window.clearInterval(timer)
    }
  }, [reducedMotion, isPlaying, interactionPaused, slideCount, goTo])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
      const root = rootRef.current
      const target = event.target as HTMLElement | null
      if (!root || !target || !root.contains(target)) return
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return
      event.preventDefault()
      if (event.key === 'ArrowRight') next()
      else prev()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [next, prev])

  const pauseInteraction = () => setInteractionPaused(true)
  const resumeInteraction = (event: FocusEvent | MouseEvent) => {
    const nextTarget = 'relatedTarget' in event ? event.relatedTarget : null
    if (nextTarget instanceof Node && rootRef.current?.contains(nextTarget)) return
    setInteractionPaused(false)
  }

  if (!current) return null

  return (
    <section
      ref={rootRef}
      className={styles.hero}
      aria-roledescription="carousel"
      aria-label="Promotional hero"
      onMouseEnter={pauseInteraction}
      onMouseLeave={resumeInteraction}
      onFocus={pauseInteraction}
      onBlur={resumeInteraction}
    >
      <div className={styles.stage}>
        {resolved.map((slide, index) => {
          const isActive = index === currentIndex
          const isNext = index === (currentIndex + 1) % slideCount
          const shouldLoad = index === 0 || isActive || (allowSecondary && isNext)
          return (
            <div
              key={slide.id}
              className={cn(styles.slide, isActive && styles.slideActive)}
              aria-hidden={!isActive}
            >
              {shouldLoad ? (
                <HeroSlideImage
                  url={slide.image}
                  alt={isActive ? slide.alt : ''}
                  className={cn(styles.image, isActive && !reducedMotion && styles.kenBurns)}
                  style={
                    isActive && !reducedMotion
                      ? { animationDuration: `${AUTOPLAY_MS}ms` }
                      : undefined
                  }
                  lcp={index === 0 && currentIndex === 0}
                />
              ) : null}
            </div>
          )
        })}
        <div className={styles.scrim} aria-hidden="true" />
      </div>

      <div className={styles.copy}>
        {current.eyebrow ? <p className={styles.eyebrow}>{current.eyebrow}</p> : null}
        <h1 id="home-hero-heading" className={styles.headline}>
          {current.headline}
        </h1>
        {current.subtext ? <p className={styles.subtext}>{current.subtext}</p> : null}
        <div className={styles.actions}>
          <Link to={current.ctaLink} className={styles.cta}>
            {current.ctaText}
          </Link>
          {current.secondaryLink ? (
            <Link to={current.secondaryLink} className={styles.secondary}>
              {current.secondaryText || 'Learn more'}
            </Link>
          ) : null}
        </div>
      </div>

      {slideCount > 1 && (
        <>
          <button
            type="button"
            className={cn(styles.navBtn, styles.prev)}
            onClick={prev}
            aria-label="Previous slide"
          >
            <ChevronLeft size={22} aria-hidden="true" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            className={cn(styles.navBtn, styles.next)}
            onClick={next}
            aria-label="Next slide"
          >
            <ChevronRight size={22} aria-hidden="true" strokeWidth={1.75} />
          </button>

          <div className={styles.dots} role="tablist" aria-label="Hero slides">
            {resolved.map((slide, index) => (
              <button
                key={slide.id}
                type="button"
                role="tab"
                aria-selected={index === currentIndex}
                aria-label={`Slide ${index + 1}: ${slide.headline}`}
                className={cn(styles.dot, index === currentIndex && styles.dotActive)}
                onClick={() => goTo(index)}
              />
            ))}
          </div>

          {!reducedMotion && (
            <button
              type="button"
              className={styles.playPause}
              onClick={() => setIsPlaying((playing) => !playing)}
              aria-label={isPlaying ? 'Pause carousel' : 'Play carousel'}
              aria-pressed={isPlaying}
            >
              {isPlaying ? (
                <Pause size={18} aria-hidden="true" />
              ) : (
                <Play size={18} aria-hidden="true" />
              )}
            </button>
          )}
        </>
      )}
    </section>
  )
}
