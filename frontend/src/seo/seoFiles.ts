/**
 * Pure builders for the two crawler files emitted at build time by the
 * `seoFiles` Vite plugin (vite.config.ts). Kept dependency-free so they
 * are safe to import from the Vite config.
 */

/** Root-relative paths that are genuinely public and known without an API. */
export const STATIC_PUBLIC_PATHS = [
  '/',
  '/products',
  '/about',
  '/contact',
  '/privacy',
  '/terms',
  '/refund-policy',
] as const

export interface CatalogSitemapPaths {
  categories?: readonly string[]
  products?: readonly string[]
}

/** Paths crawlers should not index — mirrors the `noindex` routes. */
const DISALLOW = [
  '/cart',
  '/checkout',
  '/account',
  '/orders',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/forbidden',
  '/admin',
]

export function catalogPublicPaths(catalog?: CatalogSitemapPaths | null): string[] {
  const categories = [...new Set(catalog?.categories ?? [])]
    .filter(Boolean)
    .sort()
    .map((slug) => `/products?category=${encodeURIComponent(slug)}`)
  const products = [...new Set(catalog?.products ?? [])]
    .filter(Boolean)
    .sort()
    .map((slug) => `/products/${encodeURIComponent(slug)}`)
  return [...STATIC_PUBLIC_PATHS, ...categories, ...products]
}

export function buildRobotsTxt(siteUrl: string): string {
  const origin = siteUrl.replace(/\/+$/, '')
  return [
    'User-agent: *',
    'Allow: /',
    ...DISALLOW.map((path) => `Disallow: ${path}`),
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n')
}

export function buildSitemapXml(
  siteUrl: string,
  paths: readonly string[] = STATIC_PUBLIC_PATHS,
): string {
  const origin = siteUrl.replace(/\/+$/, '')
  const urls = paths
    .map((path) => {
      const loc = escapeXml(`${origin}${path}`)
      return `  <url>\n    <loc>${loc}</loc>\n  </url>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
