import { HeroCarousel } from '@/components/home/HeroCarousel'
import { BannerGrid } from '@/components/home/BannerGrid'
import { CategoryShowcase } from '@/components/home/CategoryShowcase'
import { HomeHero } from '@/components/home/HomeHero'
import { CategoryStoryBar } from '@/components/home/CategoryStoryBar'
import { OccasionBar } from '@/components/home/OccasionBar'
import { OccasionShowcase } from '@/components/home/OccasionShowcase'
import { CraftPillars } from '@/components/home/CraftPillars'
import { CraftImpactBar } from '@/components/home/CraftImpactBar'
import { ProductRail } from '@/components/home/ProductRail'
import { TrustStrip } from '@/components/home/TrustStrip'
import { useHomepageSettings } from '@/hooks/useHomepageSettings'
import { Skeleton } from '@/components/ui/Skeleton'
import { ROUTES } from '@/constants/routes'
import { Seo } from '@/seo/Seo'
import { websiteJsonLd } from '@/seo/jsonLd'
import { StudioProcess } from '@/components/home/StudioProcess'
import { StudioStandards } from '@/components/home/StudioStandards'
import styles from './HomePage.module.css'

const HOME_DESCRIPTION =
  'Browse the PrintForge catalog and personalize mugs, apparel, frames and more — each item printed for your order.'

/**
 * Storefront landing page. Two data sources, both real:
 *  - useHomepageSettings(): admin-curated hero / banners / category
 *    showcase (optional — absent on a fresh install).
 *  - the live catalogue (CategoryRail / ProductRail → GET /categories,
 *    GET /products) which fills the page whether or not an admin has
 *    curated anything.
 *
 * When no promo hero is configured a neutral catalogue hero is shown
 * instead — no discounts, delivery promises, ratings, or testimonials are
 * invented here (see HomePage.test.tsx).
 */
export function HomePage() {
  const { data: settings, isLoading } = useHomepageSettings()

  const heroSlides = settings?.hero_slides ?? []
  const banners = settings?.banners ?? []
  const showcaseCategories = settings?.showcase_categories ?? []

  return (
    <>
      <Seo
        title=""
        description={HOME_DESCRIPTION}
        canonicalPath="/"
        jsonLd={websiteJsonLd()}
      />
      <CategoryStoryBar />
      {isLoading ? (
        <Skeleton className={styles.skeletonSlide} label="Loading homepage" />
      ) : heroSlides.length > 0 ? (
        <HeroCarousel slides={heroSlides} />
      ) : (
        <HomeHero />
      )}

      <OccasionBar />

      <OccasionShowcase />

      <CraftPillars />

      {banners.length > 0 && <BannerGrid banners={banners} />}

      {showcaseCategories.length > 0 && (
        <CategoryShowcase categories={showcaseCategories} />
      )}

      <ProductRail
        id="home-new-arrivals-heading"
        title="New arrivals"
        params={{ sort: 'newest' }}
        viewAllHref={`${ROUTES.PRODUCTS}?sort=newest`}
      />

      <StudioProcess />

      <ProductRail
        id="home-top-rated-heading"
        title="Top rated"
        params={{ sort: 'rating_desc', minRating: 4 }}
        viewAllHref={`${ROUTES.PRODUCTS}?sort=rating_desc`}
      />

      <CraftImpactBar />

      <StudioStandards />

      <TrustStrip />
    </>
  )
}
