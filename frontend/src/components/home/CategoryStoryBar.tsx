import { useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Play } from 'lucide-react'
import { ROUTES } from '@/constants/routes'
import { PromotionalVideoModal } from '@/components/ui/PromotionalVideoModal'
import styles from './CategoryStoryBar.module.css'

export interface StoryCategory {
  id: string
  title: string
  image: string
  video?: string
  href: string
  ctaText?: string
  ctaUrl?: string
}

export const UVPIXEL_STORIES: StoryCategory[] = [
  {
    id: 'custom-tshirt',
    title: 'Customize T-shirt',
    image: '/images/uvpixel/cat-custom-tshirt.jpg',
    video: '/videos/categories/t-shirts.webm',
    href: `${ROUTES.PRODUCTS}?category=t-shirts`,
    ctaText: 'आत्ताच खरेदी करा',
    ctaUrl: `${ROUTES.PRODUCTS}?category=t-shirts`,
  },
  {
    id: 'cutout',
    title: 'Cutout',
    image: '/images/uvpixel/cat-cutout-stand.jpg',
    video: '/videos/categories/all-products.webm',
    href: ROUTES.PRODUCTS,
    ctaText: 'आत्ताच खरेदी करा',
    ctaUrl: ROUTES.PRODUCTS,
  },
  {
    id: 'cutout-stand',
    title: 'Cutout Photo With Stand',
    image: '/images/uvpixel/cat-cutout-stand.jpg',
    video: '/videos/categories/name-plates.webm',
    href: `${ROUTES.PRODUCTS}?category=name-plates`,
    ctaText: 'आत्ताच खरेदी करा',
    ctaUrl: `${ROUTES.PRODUCTS}?category=name-plates`,
  },
  {
    id: 'pyrite-horses',
    title: '7 Horses on Raw Pyrite',
    image: '/images/uvpixel/cat-pyrite-horses.jpg',
    video: '/videos/categories/logo.webm',
    href: `${ROUTES.PRODUCTS}?category=logo`,
    ctaText: 'आत्ताच खरेदी करा',
    ctaUrl: `${ROUTES.PRODUCTS}?category=logo`,
  },
  {
    id: 'trophy',
    title: 'Trophy',
    image: '/images/uvpixel/cat-magnetic-badges.jpg',
    video: '/videos/categories/all-products.webm',
    href: ROUTES.PRODUCTS,
    ctaText: 'आत्ताच खरेदी करा',
    ctaUrl: ROUTES.PRODUCTS,
  },
  {
    id: 'acrylic-clock',
    title: 'Acrylic Wall Clock',
    image: '/images/uvpixel/cat-acrylic-clock.jpg',
    video: '/videos/categories/business-cards.webm',
    href: `${ROUTES.PRODUCTS}?category=business-cards`,
    ctaText: 'आत्ताच खरेदी करा',
    ctaUrl: `${ROUTES.PRODUCTS}?category=business-cards`,
  },
  {
    id: 'family-cutout',
    title: 'Cutout Family Photo With Stand',
    image: '/images/uvpixel/cat-cutout-stand.jpg',
    video: '/videos/categories/mugs.webm',
    href: `${ROUTES.PRODUCTS}?category=mugs`,
    ctaText: 'आत्ताच खरेदी करा',
    ctaUrl: `${ROUTES.PRODUCTS}?category=mugs`,
  },
  {
    id: 'business-cards',
    title: 'Business Cards',
    image: '/images/products/store/bcard-blue-gold-premium.jpg',
    video: '/videos/categories/business-cards.webm',
    href: `${ROUTES.PRODUCTS}?category=business-cards`,
    ctaText: 'आत्ताच खरेदी करा',
    ctaUrl: `${ROUTES.PRODUCTS}?category=business-cards`,
  },
  {
    id: 'mugs',
    title: 'Mugs',
    image: '/images/products/store/mug-classic-photo-memory.jpg',
    video: '/videos/categories/mugs.webm',
    href: `${ROUTES.PRODUCTS}?category=mugs`,
    ctaText: 'आत्ताच खरेदी करा',
    ctaUrl: `${ROUTES.PRODUCTS}?category=mugs`,
  },
  {
    id: 'name-plates',
    title: 'Name Plates',
    image: '/images/products/store/nameplate-flat-104.jpg',
    video: '/videos/categories/name-plates.webm',
    href: `${ROUTES.PRODUCTS}?category=name-plates`,
    ctaText: 'आत्ताच खरेदी करा',
    ctaUrl: `${ROUTES.PRODUCTS}?category=name-plates`,
  },
]

function StoryCircle({ item }: { item: StoryCategory }) {
  return (
    <div className={styles.circleWrapper}>
      <div className={styles.circleInner}>
        <img
          src={item.image}
          alt={item.title}
          className={styles.circleImage}
          loading="lazy"
        />
        {item.video && (
          <div className={styles.playBadge} aria-hidden="true">
            <Play size={10} fill="currentColor" />
          </div>
        )}
      </div>
    </div>
  )
}

export function CategoryStoryBar({ stories = UVPIXEL_STORIES }: { stories?: StoryCategory[] }) {
  const [activeStory, setActiveStory] = useState<StoryCategory | null>(null)
  const trackRef = useRef<HTMLDivElement>(null)

  const scroll = (direction: 'left' | 'right') => {
    if (!trackRef.current) return
    const offset = direction === 'left' ? -340 : 340
    trackRef.current.scrollBy({ left: offset, behavior: 'smooth' })
  }

  const handleStoryClick = (item: StoryCategory, e: React.MouseEvent) => {
    if (item.video) {
      e.preventDefault()
      setActiveStory(item)
    }
  }

  return (
    <>
      <nav className={styles.container} aria-label="Featured category stories">
        <div className={styles.inner}>
          <button
            className={`${styles.scrollBtn} ${styles.scrollBtnLeft}`}
            onClick={() => scroll('left')}
            aria-label="Scroll categories left"
            type="button"
          >
            <ChevronLeft size={20} aria-hidden="true" />
          </button>

          <div className={styles.scrollTrack} ref={trackRef}>
            {stories.map((item) => (
              <Link
                key={item.id}
                to={item.href}
                className={styles.storyItem}
                onClick={(e) => handleStoryClick(item, e)}
                aria-haspopup={item.video ? 'dialog' : undefined}
              >
                <StoryCircle item={item} />
                <span className={styles.title}>{item.title}</span>
              </Link>
            ))}
          </div>

          <button
            className={`${styles.scrollBtn} ${styles.scrollBtnRight}`}
            onClick={() => scroll('right')}
            aria-label="Scroll categories right"
            type="button"
          >
            <ChevronRight size={20} aria-hidden="true" />
          </button>
        </div>
      </nav>

      <PromotionalVideoModal
        isOpen={Boolean(activeStory)}
        onClose={() => setActiveStory(null)}
        data={
          activeStory
            ? {
                videoUrl: activeStory.video || '',
                title: activeStory.title,
                ctaText: activeStory.ctaText || 'आत्ताच खरेदी करा',
                ctaUrl: activeStory.ctaUrl || activeStory.href,
              }
            : null
        }
      />
    </>
  )
}
