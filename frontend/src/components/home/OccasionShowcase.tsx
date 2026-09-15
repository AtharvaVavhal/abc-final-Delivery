import { Link } from 'react-router-dom'
import { Star, ArrowRight, Sparkles, Heart, Gift } from 'lucide-react'
import { ROUTES } from '@/constants/routes'
import { cn } from '@/utils/cn'
import styles from './OccasionShowcase.module.css'

interface ShowcaseCard {
  id: string
  title: string
  image: string
  salePrice: string
  originalPrice: string
  discount: string
  tag?: string
  rating: string
  reviews: number
  categorySlug: string
  zoom?: boolean
}

const MERCHANDISE_CARDS: ShowcaseCard[] = [
  {
    id: 'merch-tshirt-1990',
    title: 'Originals 1990 Graphic T-Shirt',
    image: '/images/products/store/tshirt-originals-1990.jpg',
    salePrice: '₹499.00',
    originalPrice: '₹799.00',
    discount: '38% OFF',
    tag: 'Bestseller',
    rating: '4.95',
    reviews: 142,
    categorySlug: 't-shirts',
  },
  {
    id: 'merch-bcard-3d',
    title: 'Custom Premium 3D Business Cards',
    image: '/images/products/store/bcard-custom-3d-navy.jpg',
    salePrice: '₹399.00',
    originalPrice: '₹599.00',
    discount: '33% OFF',
    tag: 'Hotselling',
    rating: '5.0',
    reviews: 98,
    categorySlug: 'business-cards',
  },
  {
    id: 'merch-mug-classic',
    title: 'Classic Photo Memory Mug',
    image: '/images/products/store/mug-classic-photo-memory.jpg',
    salePrice: '₹299.00',
    originalPrice: '₹499.00',
    discount: '40% OFF',
    tag: 'Most Loved',
    rating: '4.9',
    reviews: 118,
    categorySlug: 'mugs',
  },
  {
    id: 'merch-nameplate-mukund',
    title: 'Mukund Villa Premium LED Name Plate',
    image: '/images/products/store/nameplate-mukund-villa.jpg',
    salePrice: '₹999.00',
    originalPrice: '₹1,599.00',
    discount: '38% OFF',
    tag: 'Customizable',
    rating: '5.0',
    reviews: 86,
    categorySlug: 'name-plates',
  },
]

const BRANDING_CARDS: ShowcaseCard[] = [
  {
    id: 'brand-logo-iphone',
    title: 'iPhone LED Logo Wall Sign',
    image: '/images/products/store/logo-iphone-led-sign.jpg',
    salePrice: '₹799.00',
    originalPrice: '₹1,299.00',
    discount: '38% OFF',
    tag: 'Premium',
    rating: '5.0',
    reviews: 64,
    categorySlug: 'logo',
  },
  {
    id: 'brand-tshirt-hustle',
    title: 'Hustle Graffiti Graphic T-Shirt',
    image: '/images/products/store/tshirt-hustle-graffiti.jpg',
    salePrice: '₹499.00',
    originalPrice: '₹799.00',
    discount: '38% OFF',
    tag: 'Streetwear',
    rating: '5.0',
    reviews: 110,
    categorySlug: 't-shirts',
  },
  {
    id: 'brand-bcard-gold',
    title: 'Premium Blue Gold Business Cards',
    image: '/images/products/store/bcard-blue-gold-premium.jpg',
    salePrice: '₹399.00',
    originalPrice: '₹599.00',
    discount: '33% OFF',
    tag: 'Luxury',
    rating: '4.95',
    reviews: 86,
    categorySlug: 'business-cards',
  },
  {
    id: 'brand-logo-realme',
    title: 'Realme LED Logo Wall Sign',
    image: '/images/products/store/logo-realme-led-sign.jpg',
    salePrice: '₹799.00',
    originalPrice: '₹1,299.00',
    discount: '38% OFF',
    tag: 'Trending',
    rating: '4.95',
    reviews: 58,
    categorySlug: 'logo',
  },
]

interface OccasionShowcaseProps {
  sectionId?: string
}

export function OccasionShowcase({ sectionId }: OccasionShowcaseProps) {
  return (
    <div id={sectionId} className={styles.wrapper}>
      {/* Custom Merchandise Collection */}
      <section className={styles.section} aria-labelledby="merchandise-collection-heading">
        <div className={styles.container}>
          <div className={styles.header}>
            <div className={styles.headerLeft}>
              <div className={styles.eyebrow}>
                <Sparkles size={15} className={styles.eyebrowIcon} aria-hidden="true" />
                <span>Custom Merchandise Essentials</span>
              </div>
              <h2 id="merchandise-collection-heading" className={styles.title}>
                Bestselling Custom Prints
              </h2>
              <p className={styles.subtitle}>
                High-definition custom printing on t-shirts, business cards, ceramic mugs, and designer name plates.
              </p>
            </div>
            <Link
              to={`${ROUTES.PRODUCTS}?category=t-shirts`}
              className={styles.viewAllBtn}
            >
              <span>View All Custom Merchandise</span>
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>

          <div className={styles.grid}>
            {MERCHANDISE_CARDS.map((card) => (
              <ProductCraftCard key={card.id} card={card} />
            ))}
          </div>
        </div>
      </section>

      {/* Corporate Branding & Signage Collection */}
      <section className={styles.section} aria-labelledby="branding-signage-heading">
        <div className={styles.container}>
          <div className={styles.header}>
            <div className={styles.headerLeft}>
              <div className={styles.eyebrow}>
                <Heart size={15} className={styles.eyebrowIcon} aria-hidden="true" />
                <span>Corporate Identity & Signage</span>
              </div>
              <h2 id="branding-signage-heading" className={styles.title}>
                Corporate Branding & Signs
              </h2>
              <p className={styles.subtitle}>
                Transform your office presence with illuminated 3D logo signs, executive name plates, and branded polo apparel.
              </p>
            </div>
            <Link
              to={`${ROUTES.PRODUCTS}?category=logo`}
              className={styles.viewAllBtn}
            >
              <span>View All Corporate Signage</span>
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>

          <div className={styles.grid}>
            {BRANDING_CARDS.map((card) => (
              <ProductCraftCard key={card.id} card={card} />
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

function ProductCraftCard({ card }: { card: ShowcaseCard }) {
  return (
    <div className={styles.card}>
      <Link
        to={`${ROUTES.PRODUCTS}?category=${encodeURIComponent(card.categorySlug)}`}
        className={styles.imageLink}
      >
        <div className={styles.imageContainer}>
          <img
            src={card.image}
            alt={card.title}
            className={cn(styles.image, card.zoom && styles.imageZoom)}
            loading="lazy"
          />
          <div className={styles.badgeGroup}>
            {card.tag && <span className={styles.tagBadge}>{card.tag}</span>}
            <span className={styles.discountBadge}>{card.discount}</span>
          </div>
        </div>
      </Link>

      <div className={styles.cardContent}>
        <div className={styles.ratingRow}>
          <span className={styles.starIcon} aria-hidden="true">
            <Star size={13} fill="#f59e0b" color="#f59e0b" />
          </span>
          <span className={styles.ratingVal}>{card.rating}</span>
          <span className={styles.reviewCount}>({card.reviews})</span>
        </div>

        <h3 className={styles.cardTitle}>
          <Link
            to={`${ROUTES.PRODUCTS}?category=${encodeURIComponent(card.categorySlug)}`}
            className={styles.titleLink}
          >
            {card.title}
          </Link>
        </h3>

        <div className={styles.priceRow}>
          <span className={styles.salePrice}>{card.salePrice}</span>
          <span className={styles.originalPrice}>{card.originalPrice}</span>
          <span className={styles.savePercent}>40% Off</span>
        </div>

        <Link
          to={`${ROUTES.PRODUCTS}?category=${encodeURIComponent(card.categorySlug)}`}
          className={styles.shopButton}
        >
          <Gift size={14} aria-hidden="true" />
          <span>Personalize Now</span>
        </Link>
      </div>
    </div>
  )
}
