/**
 * LCP/hero delivery for local `/catalog/hero-*.jpg` files.
 *
 * Source of truth: the original JPEG in `public/catalog/` (admin snapshot
 * still stores that path). Production delivery uses generated AVIF/WebP/JPEG
 * variants in `public/catalog/optimized/`, built by
 * `scripts/optimize-hero-images.mjs`. Cloudinary URLs keep `f_auto,q_auto`.
 */
export const HERO_LCP_WIDTHS = [480, 768, 1024, 1280] as const
export const HERO_LCP_SIZES = '100vw'
export const HERO_LCP_INTRINSIC_WIDTH = 1280
export const HERO_LCP_INTRINSIC_HEIGHT = 582
export const HERO_PRELOAD_WIDTH = 768

const LOCAL_HERO = /^\/catalog\/(hero-\d+)\.jpe?g$/i
const CLOUDINARY_UPLOAD =
  /^(https:\/\/res\.cloudinary\.com\/[^/]+\/(?:image|video)\/upload\/)(.+)$/i

export type HeroImageFormat = 'avif' | 'webp' | 'jpg'

export function localHeroBasename(url: string): string | null {
  const match = url.trim().match(LOCAL_HERO)
  return match ? match[1] : null
}

export function isCloudinaryUploadUrl(url: string): boolean {
  return CLOUDINARY_UPLOAD.test(url)
}

export function optimizedCloudinaryHeroUrl(url: string, width: number): string {
  const match = url.match(CLOUDINARY_UPLOAD)
  if (!match) return url
  const rest = match[2]
  if (rest.startsWith('s--')) return url
  if (/^(?:f_auto|q_auto|c_limit|w_\d+|c_fill|c_fit)/.test(rest)) return url
  return `${match[1]}f_auto,q_auto,c_limit,w_${Math.round(width)}/${rest}`
}

export function optimizedHeroUrl(
  url: string,
  width: number,
  format: HeroImageFormat = 'jpg',
): string {
  const base = localHeroBasename(url)
  if (base) {
    return `/catalog/optimized/${base}-${width}.${format}`
  }
  if (isCloudinaryUploadUrl(url)) {
    return optimizedCloudinaryHeroUrl(url, width)
  }
  return url
}

export function heroSrcSet(url: string, format: HeroImageFormat): string {
  return HERO_LCP_WIDTHS.map(
    (width) => `${optimizedHeroUrl(url, width, format)} ${width}w`,
  ).join(', ')
}

export function heroFallbackSrc(url: string): string {
  return optimizedHeroUrl(url, HERO_PRELOAD_WIDTH, 'jpg')
}

export interface HeroLcpPreload {
  href: string
  imagesrcset: string
  imagesizes: string
  type: string
}

export function heroLcpPreload(url: string): HeroLcpPreload {
  if (localHeroBasename(url)) {
    return {
      href: optimizedHeroUrl(url, HERO_PRELOAD_WIDTH, 'avif'),
      imagesrcset: heroSrcSet(url, 'avif'),
      imagesizes: HERO_LCP_SIZES,
      type: 'image/avif',
    }
  }
  if (isCloudinaryUploadUrl(url)) {
    const href = optimizedCloudinaryHeroUrl(url, HERO_PRELOAD_WIDTH)
    return {
      href,
      imagesrcset: HERO_LCP_WIDTHS.map(
        (width) => `${optimizedCloudinaryHeroUrl(url, width)} ${width}w`,
      ).join(', '),
      imagesizes: HERO_LCP_SIZES,
      type: 'image/avif',
    }
  }
  return {
    href: url,
    imagesrcset: url,
    imagesizes: HERO_LCP_SIZES,
    type: 'image/jpeg',
  }
}

export function heroPictureHtml(url: string, alt: string, lcp: boolean): string {
  const avif = heroSrcSet(url, 'avif')
  const webp = heroSrcSet(url, 'webp')
  const jpeg = heroSrcSet(url, 'jpg')
  const fallback = heroFallbackSrc(url)
  const priority = lcp ? 'high' : 'low'
  const loading = lcp ? 'eager' : 'lazy'
  return `<picture>
  <source type="image/avif" srcset="${avif}" sizes="${HERO_LCP_SIZES}" />
  <source type="image/webp" srcset="${webp}" sizes="${HERO_LCP_SIZES}" />
  <img src="${fallback}" srcset="${jpeg}" sizes="${HERO_LCP_SIZES}" width="${HERO_LCP_INTRINSIC_WIDTH}" height="${HERO_LCP_INTRINSIC_HEIGHT}" alt="${alt}" fetchpriority="${priority}" decoding="async" loading="${loading}" />
</picture>`
}

export function heroMediaHtml(url: string, alt: string, lcp: boolean): string {
  if (localHeroBasename(url)) {
    return heroPictureHtml(url, alt, lcp)
  }
  const srcset = heroSrcSet(url, 'jpg')
  const src = optimizedHeroUrl(url, HERO_PRELOAD_WIDTH, 'jpg')
  const priority = lcp ? 'high' : 'low'
  const loading = lcp ? 'eager' : 'lazy'
  return `<img src="${src}" srcset="${srcset}" sizes="${HERO_LCP_SIZES}" width="${HERO_LCP_INTRINSIC_WIDTH}" height="${HERO_LCP_INTRINSIC_HEIGHT}" alt="${alt}" fetchpriority="${priority}" decoding="async" loading="${loading}" />`
}

export function lcpSnapshot(url: string | undefined): {
  sourceUrl: string
  href: string
  type: string
  sizes: string
  srcsetAvif: string
  srcsetWebp: string
  srcsetJpg: string
  fallback: string
} | null {
  if (!url) return null
  const preload = heroLcpPreload(url)
  return {
    sourceUrl: url,
    href: preload.href,
    type: preload.type,
    sizes: preload.imagesizes,
    srcsetAvif: localHeroBasename(url) ? heroSrcSet(url, 'avif') : preload.imagesrcset,
    srcsetWebp: localHeroBasename(url) ? heroSrcSet(url, 'webp') : '',
    srcsetJpg: localHeroBasename(url) ? heroSrcSet(url, 'jpg') : preload.imagesrcset,
    fallback: heroFallbackSrc(url),
  }
}
