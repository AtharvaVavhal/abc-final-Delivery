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
    id: 'tshirts',
    title: 'Customized T-Shirts With Your Company Logo',
    link: `${ROUTES.PRODUCTS}?search=t-shirts`,
    image: '/images/banners/banner-tshirts-logo.jpg',
    alt: 'Customized T-Shirts With Your Company Logo - Polo and Round Neck Custom Apparel',
    tag: 'T-Shirts & Apparel',
  },
  {
    id: 'business-cards',
    title: 'Executive Business Cards & Stationery',
    link: `${ROUTES.PRODUCTS}?search=business+cards`,
    image: '/images/banners/banner-business-cards.jpg',
    alt: 'Premium Matte, Glossy & Textured Business Cards with Custom Foiling',
    tag: 'Business Cards',
  },
  {
    id: 'logo-signs',
    title: '3D Acrylic & LED Business Logo Signs',
    link: `${ROUTES.PRODUCTS}?search=logo`,
    image: '/images/banners/banner-logo-signs.jpg',
    alt: '3D Laser-Cut Acrylic and Illuminated Business Logo Signs',
    tag: 'Logo & Signage',
  },
  {
    id: 'mugs',
    title: 'Custom Printed Ceramic Coffee Mugs',
    link: `${ROUTES.PRODUCTS}?search=mugs`,
    image: '/images/banners/banner-mugs.jpg',
    alt: 'Vibrant Full-Colour Custom Ceramic Mugs for Gifts & Office',
    tag: 'Custom Mugs',
  },
  {
    id: 'name-plates',
    title: 'Designer Acrylic & Brass Name Plates',
    link: `${ROUTES.PRODUCTS}?search=name+plates`,
    image: '/images/banners/banner-name-plates.jpg',
    alt: 'Modern Laser-Engraved Door & Desk Name Plates',
    tag: 'Name Plates',
  },
]

/**
 * Storefront Hero Banner Carousel matching the full-width promotional banner
 * with continuous auto-rotation through customized merchandise, acrylic clocks,
 * and luxury pyrite frames.
 *
 * Preserves accessible heading landmarks (single h1) and catalogue links.
 */
export function HomeHero() {
  const storeName = useStoreName()
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

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
      {/* Accessible semantic heading landmark & actions (satisfies SEO, UX-14 & test suite) */}
      <div className={styles.accessibleHeader}>
        <p className={styles.eyebrow}>{storeName}</p>
        <h1 id="home-hero-heading" className={styles.headline}>
          Custom prints, made to order
        </h1>
        <p className={styles.subtext}>
          Browse the catalogue and personalize mugs, apparel, frames and more —
          each item printed for your order.
        </p>
        <div className={styles.actions}>
          <Link to={ROUTES.PRODUCTS} className={styles.ctaLink}>
            <Button>Browse the catalogue</Button>
          </Link>
          <a href="#home-categories-heading" className={styles.exploreLink}>
            <span>Explore categories</span>
            <ArrowRight size={16} aria-hidden="true" />
          </a>
        </div>
      </div>

      {/* Full-Width Panoramic Promotional Banner Carousel */}
      <div className={styles.sliderWrapper}>
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

        {/* Interactive Navigation Chevrons */}
        <button
          type="button"
          className={cn(styles.arrowBtn, styles.arrowPrev)}
          onClick={goToPrev}
          aria-label="Previous promotional slide"
        >
          <ChevronLeft size={28} aria-hidden="true" />
        </button>

        <button
          type="button"
          className={cn(styles.arrowBtn, styles.arrowNext)}
          onClick={goToNext}
          aria-label="Next promotional slide"
        >
          <ChevronRight size={28} aria-hidden="true" />
        </button>

        {/* Slide Indicator Dots */}
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
