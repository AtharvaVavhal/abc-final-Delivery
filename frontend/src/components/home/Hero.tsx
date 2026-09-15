import { useCallback, useEffect, useRef, useState } from 'react'
import type { FocusEvent, MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ROUTES } from '@/constants/routes'
import { cn } from '@/utils/cn'
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

export const FALLBACK_HERO_SLIDES: HeroSlide[] = [
  {
    id: 'acrylic-gifts',
    eyebrow: 'Acrylic gifts',
    headline: 'Caricatures that capture the moment',
    subtext: 'Hand-illustrated acrylic art from your favorite photo.',
    ctaText: 'Shop caricatures',
    ctaLink: `${ROUTES.PRODUCTS}?category=acrylic-gifts`,
    image: '/catalog/hero-3.jpg',
    alt: 'Acrylic caricatures and cutouts on a studio table',
  },
  {
    id: 'corporate-gifting',
    eyebrow: 'Corporate gifting',
    headline: 'Branded gifts your team will keep',
    subtext: 'Custom corporate pieces, made to order and ready to ship.',
    ctaText: 'Shop corporate gifts',
    ctaLink: `${ROUTES.PRODUCTS}?category=corporate`,
    image: '/catalog/hero-4.jpg',
    alt: 'Corporate polo, diary, bottle and pen on a desk',
  },
  {
    id: 'festive-keepsakes',
    eyebrow: 'Festive keepsakes',
    headline: 'Wedding and festive keepsakes',
    subtext: 'Personalised acrylic plaques for the people you celebrate.',
    ctaText: 'Shop gifts',
    ctaLink: `${ROUTES.PRODUCTS}?category=festive`,
    image: '/catalog/hero-5.jpg',
    alt: 'Acrylic couple plaque with festive gift wrapping',
  },
]

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

export function Hero({ slides }: { slides?: HeroSlide[] }) {
  const resolved = slides && slides.length > 0 ? slides : FALLBACK_HERO_SLIDES
  const slideCount = resolved.length
  const reducedMotion = usePrefersReducedMotion()

  const [currentIndex, setCurrentIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(true)
  const [interactionPaused, setInteractionPaused] = useState(false)
  const rootRef = useRef<HTMLElement>(null)

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
    if (reducedMotion || !isPlaying || interactionPaused || slideCount <= 1) return
    const timer = window.setInterval(next, AUTOPLAY_MS)
    return () => window.clearInterval(timer)
  }, [reducedMotion, isPlaying, interactionPaused, slideCount, next])

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
          return (
            <div
              key={slide.id}
              className={cn(styles.slide, isActive && styles.slideActive)}
              aria-hidden={!isActive}
            >
              <img
                key={isActive ? `${slide.id}-active` : slide.id}
                src={slide.image}
                alt={isActive ? slide.alt : ''}
                className={cn(styles.image, isActive && !reducedMotion && styles.kenBurns)}
                style={
                  isActive && !reducedMotion
                    ? { animationDuration: `${AUTOPLAY_MS}ms` }
                    : undefined
                }
                loading={index === 0 ? 'eager' : 'lazy'}
              />
            </div>
          )
        })}
        <div className={styles.scrim} aria-hidden="true" />
      </div>

      <div className={styles.copy}>
        <p className={styles.eyebrow}>{current.eyebrow}</p>
        <h1 id="home-hero-heading" className={styles.headline}>
          {current.headline}
        </h1>
        <p className={styles.subtext}>{current.subtext}</p>
        <div className={styles.actions}>
          <Link to={current.ctaLink} className={styles.cta}>
            <Button variant="primary" shape="pill" size="lg">
              {current.ctaText}
            </Button>
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
