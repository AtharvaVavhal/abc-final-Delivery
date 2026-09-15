import { Link } from 'react-router-dom'
import { Coffee, Shirt, Frame, CreditCard, Palette, type LucideIcon } from 'lucide-react'
import { useCategories } from '@/hooks/useCategories'
import { ROUTES } from '@/constants/routes'
import { Skeleton } from '@/components/ui/Skeleton'
import { SectionHeading } from './SectionHeading'
import styles from './CategoryRail.module.css'

function getCategoryIcon(name: string, slug: string): LucideIcon | null {
  const s = (slug + ' ' + name).toLowerCase()
  if (s.includes('mug') || s.includes('cup')) return Coffee
  if (s.includes('shirt') || s.includes('apparel') || s.includes('wear') || s.includes('hoodie')) return Shirt
  if (s.includes('frame') || s.includes('photo') || s.includes('poster')) return Frame
  if (s.includes('card') || s.includes('business')) return CreditCard
  if (s.includes('sign') || s.includes('plate') || s.includes('logo') || s.includes('craft')) return Palette
  return null
}

/**
 * "Shop by Category" backed by the live public catalogue
 * (GET /categories — active categories only, server-side). Used on the
 * homepage when an admin has not curated a showcase
 * (settings.showcase_categories); CategoryShowcase renders that instead.
 *
 * The Category API carries no imagery, so these are typographic cards —
 * no stock photos or invented category art. Only top-level categories are
 * shown here; sub-categories surface on the listing page's filters.
 */
export function CategoryRail() {
  const { data: categories, isPending, isError } = useCategories()

  if (isError) return null

  const topLevel = (categories ?? []).filter((c) => c.parentCategoryId === null)

  if (!isPending && topLevel.length === 0) return null

  return (
    <section className={styles.section} aria-labelledby="home-categories-heading">
      <SectionHeading
        id="home-categories-heading"
        title="Shop by category"
        viewAllHref={ROUTES.PRODUCTS}
        viewAllLabel="All products"
      />

      {isPending ? (
        <ul className={styles.rail} aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className={styles.item}>
              <Skeleton className={styles.skeletonCard} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className={styles.rail}>
          {topLevel.map((category) => {
            const Icon = getCategoryIcon(category.name, category.slug)
            return (
              <li key={category.id} className={styles.item}>
                <Link
                  to={`${ROUTES.PRODUCTS}?categoryId=${encodeURIComponent(category.id)}`}
                  className={styles.card}
                >
                  <span className={styles.mark} aria-hidden="true">
                    {Icon ? (
                      <Icon size={22} strokeWidth={1.8} />
                    ) : (
                      category.name.charAt(0).toUpperCase()
                    )}
                  </span>
                  <span className={styles.name}>{category.name}</span>
                  <span className={styles.browsePill} aria-hidden="true">Explore →</span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
