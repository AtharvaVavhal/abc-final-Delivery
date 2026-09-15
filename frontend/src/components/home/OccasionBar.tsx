import { Link } from 'react-router-dom'
import { Sparkles, CreditCard, Coffee, Shirt, BadgeCheck, Package } from 'lucide-react'
import { ROUTES } from '@/constants/routes'
import styles from './OccasionBar.module.css'

interface OccasionItem {
  id: string
  label: string
  icon: typeof Sparkles
  query: string
  badge?: string
}

const OCCASIONS: OccasionItem[] = [
  {
    id: 'all',
    label: 'All Products',
    icon: Package,
    query: '',
    badge: 'Catalogue',
  },
  {
    id: 'business-cards',
    label: 'Business Cards',
    icon: CreditCard,
    query: 'business-cards',
    badge: '40% OFF',
  },
  {
    id: 'logo',
    label: 'Logo & Signage',
    icon: Sparkles,
    query: 'logo',
    badge: 'Trending',
  },
  {
    id: 'mugs',
    label: 'Custom Mugs',
    icon: Coffee,
    query: 'mugs',
    badge: 'Hot',
  },
  {
    id: 'name-plates',
    label: 'Name Plates',
    icon: BadgeCheck,
    query: 'name-plates',
    badge: 'Premium',
  },
  {
    id: 't-shirts',
    label: 'Custom T-Shirts',
    icon: Shirt,
    query: 't-shirts',
    badge: 'Best Seller',
  },
]

export function OccasionBar() {
  return (
    <section className={styles.container} aria-label="Shop by Core Products">
      <div className={styles.inner}>
        <div className={styles.titleWrapper}>
          <span className={styles.titleIcon} aria-hidden="true">
            <Sparkles size={16} />
          </span>
          <span className={styles.titleText}>Core Products</span>
        </div>

        <div className={styles.scrollWrapper}>
          <div className={styles.chipTrack} role="list">
            {OCCASIONS.map((item) => {
              const Icon = item.icon
              const toUrl = item.query
                ? `${ROUTES.PRODUCTS}?category=${encodeURIComponent(item.query)}`
                : ROUTES.PRODUCTS
              return (
                <div key={item.id} role="listitem" className={styles.chipWrapper}>
                  <Link
                    to={toUrl}
                    className={styles.chip}
                  >
                    <Icon size={16} className={styles.chipIcon} aria-hidden="true" />
                    <span className={styles.chipLabel}>{item.label}</span>
                    {item.badge && (
                      <span className={styles.chipBadge}>{item.badge}</span>
                    )}
                  </Link>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
