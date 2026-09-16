import { lazy, Suspense, type ReactNode } from 'react'
import { Hero, HeroFallback, type HeroSlide as StorefrontHeroSlide } from '@/components/home/Hero'
import { CategoryCircleCarousel } from '@/components/home/CategoryStoryBar'
import { LazySection } from '@/components/ui/LazySection'
import { useHomepageSettings } from '@/hooks/useHomepageSettings'
import { useStoreName } from '@/hooks/useStoreName'
import type { HeroSlide as SettingsHeroSlide } from '@/services/api/settings'
import { ROUTES } from '@/constants/routes'
import { Seo } from '@/seo/Seo'
import { websiteJsonLd } from '@/seo/jsonLd'
import styles from './HomePage.module.css'

const TrustStrip = lazy(() =>
  import('@/components/home/TrustStrip').then((m) => ({ default: m.TrustStrip })),
)
const StudioProcess = lazy(() =>
  import('@/components/home/StudioProcess').then((m) => ({ default: m.StudioProcess })),
)
const WatchAndBuySection = lazy(() =>
  import('@/components/home/WatchAndBuySection').then((m) => ({ default: m.WatchAndBuySection })),
)
const ProductCollection = lazy(() =>
  import('@/components/home/ProductRail').then((m) => ({ default: m.ProductCollection })),
)
const CategoryProductCollections = lazy(() =>
  import('@/components/home/CategoryProductCollections').then((m) => ({
    default: m.CategoryProductCollections,
  })),
)
const BannerGrid = lazy(() =>
  import('@/components/home/BannerGrid').then((m) => ({ default: m.BannerGrid })),
)
const CategoryDiscovery = lazy(() =>
  import('@/components/home/CategoryDiscovery').then((m) => ({ default: m.CategoryDiscovery })),
)
const BrandStory = lazy(() =>
  import('@/components/home/BrandStory').then((m) => ({ default: m.BrandStory })),
)
const FeaturedMediaCarousel = lazy(() =>
  import('@/components/home/FeaturedMediaCarousel').then((m) => ({
    default: m.FeaturedMediaCarousel,
  })),
)

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

function BelowFold({ children }: { children: ReactNode }) {
  return (
    <LazySection>
      <Suspense fallback={null}>{children}</Suspense>
    </LazySection>
  )
}

/**
 * Storefront landing page. Navbar + hero shell paint immediately. Catalogue
 * rails and category media come from GET /categories and GET /products.
 * Optional hero/banners/story/featured media come from public store settings.
 *
 * Critical path: Seo, hero (or branded fallback), category circles.
 * Everything else mounts when it approaches the viewport.
 */
export function HomePage() {
  const { data: settings, isLoading } = useHomepageSettings()
  const storeName = useStoreName()

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
      {heroSlides.length > 0 ? (
        <Hero slides={toStorefrontHeroSlides(heroSlides)} />
      ) : isLoading ? (
        <HeroFallback title={storeName} busy />
      ) : (
        <h1 className={styles.homeHeading}>{storeName}</h1>
      )}

      <CategoryCircleCarousel />

      <BelowFold>
        <TrustStrip />
      </BelowFold>

      <BelowFold>
        <StudioProcess />
      </BelowFold>

      <BelowFold>
        <WatchAndBuySection />
      </BelowFold>

      <BelowFold>
        <ProductCollection
          id="home-featured-heading"
          title="Featured Collection"
          params={{ sort: 'newest' }}
          viewAllHref={`${ROUTES.PRODUCTS}?sort=newest`}
          layout="grid"
        />
      </BelowFold>

      <BelowFold>
        <ProductCollection
          id="home-top-rated-heading"
          title="Top rated"
          params={{ sort: 'rating_desc', minRating: 4 }}
          viewAllHref={`${ROUTES.PRODUCTS}?sort=rating_desc`}
        />
      </BelowFold>

      <BelowFold>
        <CategoryProductCollections />
      </BelowFold>

      {banners.length > 0 && (
        <BelowFold>
          <BannerGrid banners={banners} />
        </BelowFold>
      )}

      {showcaseCategories.length > 0 && (
        <BelowFold>
          <CategoryDiscovery curated={showcaseCategories} />
        </BelowFold>
      )}

      <BelowFold>
        <BrandStory story={settings?.brand_story} />
      </BelowFold>

      <BelowFold>
        <FeaturedMediaCarousel urls={featuredMedia} />
      </BelowFold>
    </>
  )
}
