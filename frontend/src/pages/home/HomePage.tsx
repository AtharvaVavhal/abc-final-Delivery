import { BannerGrid } from '@/components/home/BannerGrid'
import { Hero, type HeroSlide as StorefrontHeroSlide } from '@/components/home/Hero'
import { CategoryCircleCarousel } from '@/components/home/CategoryStoryBar'
import { WatchAndBuySection } from '@/components/home/WatchAndBuySection'
import { ProductCollection } from '@/components/home/ProductRail'
import { CategoryProductCollections } from '@/components/home/CategoryProductCollections'
import { CategoryDiscovery } from '@/components/home/CategoryDiscovery'
import { BrandStory } from '@/components/home/BrandStory'
import { FeaturedMediaCarousel } from '@/components/home/FeaturedMediaCarousel'
import { TrustStrip } from '@/components/home/TrustStrip'
import { StudioProcess } from '@/components/home/StudioProcess'
import { useHomepageSettings } from '@/hooks/useHomepageSettings'
import { Skeleton } from '@/components/ui/Skeleton'
import type { HeroSlide as SettingsHeroSlide } from '@/services/api/settings'
import { ROUTES } from '@/constants/routes'
import { Seo } from '@/seo/Seo'
import { websiteJsonLd } from '@/seo/jsonLd'
import styles from './HomePage.module.css'

const HOME_DESCRIPTION =
  'Browse the AB Creations catalog and personalize products that support customization — each item printed for your order.'

function toStorefrontHeroSlides(slides: SettingsHeroSlide[]): StorefrontHeroSlide[] {
  return slides.map((slide, index) => ({
    id: `hero-${index}`,
    image: slide.imageUrl,
    alt: slide.headline,
    eyebrow: '',
    headline: slide.headline,
    subtext: slide.subtext,
    ctaText: slide.ctaText,
    ctaLink: slide.ctaLink,
  }))
}

/**
 * Storefront landing page. Catalogue rails and category media come from
 * GET /categories and GET /products. Optional hero/banners/story/featured
 * media come from public store settings.
 */
export function HomePage() {
  const { data: settings, isLoading } = useHomepageSettings()

  const heroSlides = settings?.hero_slides ?? []
  const banners = settings?.banners ?? []
  const showcaseCategories = settings?.showcase_categories ?? []
  const featuredMedia = settings?.featured_media ?? []

  return (
    <>
      <Seo
        title=""
        description={HOME_DESCRIPTION}
        canonicalPath="/"
        jsonLd={websiteJsonLd()}
      />
      {isLoading ? (
        <Skeleton className={styles.skeletonSlide} label="Loading homepage" />
      ) : (
        <Hero slides={toStorefrontHeroSlides(heroSlides)} />
      )}

      <CategoryCircleCarousel />

      <TrustStrip />

      <StudioProcess />

      <WatchAndBuySection />

      <ProductCollection
        id="home-featured-heading"
        title="Featured Collection"
        params={{ sort: 'newest' }}
        viewAllHref={`${ROUTES.PRODUCTS}?sort=newest`}
        layout="grid"
      />

      <ProductCollection
        id="home-top-rated-heading"
        title="Top rated"
        params={{ sort: 'rating_desc', minRating: 4 }}
        viewAllHref={`${ROUTES.PRODUCTS}?sort=rating_desc`}
      />

      <CategoryProductCollections />

      {banners.length > 0 && <BannerGrid banners={banners} />}

      {showcaseCategories.length > 0 && <CategoryDiscovery curated={showcaseCategories} />}

      <BrandStory story={settings?.brand_story} />

      <FeaturedMediaCarousel urls={featuredMedia} />
    </>
  )
}
