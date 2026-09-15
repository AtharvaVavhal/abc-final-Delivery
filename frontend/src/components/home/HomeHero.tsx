import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, ArrowRight } from 'lucide-react'
import { ROUTES } from '@/constants/routes'
import { Button } from '@/components/ui/Button'
import { useStoreName } from '@/hooks/useStoreName'
import { cn } from '@/utils/cn'
import styles from './HomeHero.module.css'

interface HeroBannerSlide {
  id: string
  title: string
  link: string
  image: string
  alt: string
  tag: string
}

const HERO_BANNER_SLIDES: HeroBannerSlide[] = [
  {
    id: 'studio-1',
    title: 'Acrylic caricatures from your photo',
    link: `${ROUTES.PRODUCTS}?category=acrylic-gifts`,
    image: '/catalog/hero-3.jpg',
    alt: 'Acrylic caricatures and cutouts on a studio table',
    tag: 'Acrylic gifts',
  },
  {
    id: 'studio-2',
    title: 'Corporate gifting, ready for your brand',
    link: `${ROUTES.PRODUCTS}?category=corporate-and-branding`,
    image: '/catalog/hero-4.jpg',
    alt: 'Corporate polo, diary, bottle and pen on a desk',
    tag: 'Corporate',
  },
  {
    id: 'studio-3',
    title: 'Wedding and festive keepsakes',
    link: `${ROUTES.PRODUCTS}?category=personalized-gifts`,
    image: '/catalog/hero-5.jpg',
    alt: 'Acrylic couple plaque with festive gift wrapping',
    tag: 'Festive',
  },
]

const SWIPE_THRESHOLD = 56

/**
 * Storefront hero carousel. Same slides, images, autoplay, and catalogue
 * links — restyled as a product-led merch hero with CSS type overlay.
 */
export function HomeHero() {
  const storeName = useStoreName()
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pointerX = useRef<number | null>(null)
  const current = HERO_BANNER_SLIDES[currentIndex]

  useEffect(() => {
    if (isPaused) return

    timerRef.current = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % HERO_BANNER_SLIDES.length)
    }, 3600)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [isPaused])

  const goToPrev = () => {
    setCurrentIndex((prev) => (prev === 0 ? HERO_BANNER_SLIDES.length - 1 : prev - 1))
  }

  const goToNext = () => {
    setCurrentIndex((prev) => (prev + 1) % HERO_BANNER_SLIDES.length)
  }

  return (
    <section
      className={styles.hero}
      aria-labelledby="home-hero-heading"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <div
        className={styles.sliderWrapper}
        onPointerDown={(event) => {
          if (event.pointerType === 'mouse' && event.button !== 0) return
          pointerX.current = event.clientX
        }}
        onPointerUp={(event) => {
          if (pointerX.current == null) return
          const delta = event.clientX - pointerX.current
          pointerX.current = null
          if (delta > SWIPE_THRESHOLD) goToPrev()
          else if (delta < -SWIPE_THRESHOLD) goToNext()
        }}
        onPointerCancel={() => {
          pointerX.current = null
        }}
      >
        <div className={styles.visual}>
          <div className={styles.sliderTrack}>
            {HERO_BANNER_SLIDES.map((slide, index) => {
              const isActive = index === currentIndex
              return (
                <div
                  key={slide.id}
                  className={cn(styles.slideItem, isActive && styles.slideActive)}
                  aria-hidden={!isActive}
                >
                  <Link
                    to={slide.link}
                    className={styles.slideLink}
                    tabIndex={isActive ? 0 : -1}
                    aria-label={slide.title}
                  >
                    <img
                      src={slide.image}
                      alt={slide.alt}
                      className={styles.bannerImg}
                      loading={index === 0 ? 'eager' : 'lazy'}
                    />
                  </Link>
                </div>
              )
            })}
          </div>
          <div className={styles.veil} aria-hidden="true" />
          <div className={styles.glow} aria-hidden="true" />
        </div>

        <div className={styles.copy}>
          <p className={styles.eyebrow}>{storeName}</p>
          <h1 id="home-hero-heading" className={styles.headline}>
            Custom prints, made to order
          </h1>
          <p className={styles.collection}>{current.tag}</p>
          <p className={styles.subtext}>
            Browse the live catalog and personalize products that include customization
            fields — each order is printed in the studio.
          </p>
          <div className={styles.actions}>
            <Link to={ROUTES.PRODUCTS} className={styles.customizeCta}>
              Customize Now
            </Link>
            <Link to={ROUTES.PRODUCTS} className={styles.ctaLink}>
              <Button>Browse the catalogue</Button>
            </Link>
            <Link to={ROUTES.PRODUCTS} className={styles.exploreLink}>
              <span>Explore catalog</span>
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </div>

        <button
          type="button"
          className={cn(styles.arrowBtn, styles.arrowPrev)}
          onClick={goToPrev}
          aria-label="Previous promotional slide"
        >
          <ChevronLeft size={22} aria-hidden="true" strokeWidth={1.75} />
        </button>

        <button
          type="button"
          className={cn(styles.arrowBtn, styles.arrowNext)}
          onClick={goToNext}
          aria-label="Next promotional slide"
        >
          <ChevronRight size={22} aria-hidden="true" strokeWidth={1.75} />
        </button>

        <div className={styles.dotsContainer} role="tablist" aria-label="Promotional banner slides">
          {HERO_BANNER_SLIDES.map((slide, idx) => (
            <button
              key={slide.id}
              type="button"
              role="tab"
              aria-selected={idx === currentIndex}
              aria-label={`Slide ${idx + 1}: ${slide.title}`}
              className={cn(styles.dot, idx === currentIndex && styles.dotActive)}
              onClick={() => setCurrentIndex(idx)}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
