import type { Product } from '@/types/catalog'
import type { Crumb } from '@/components/ui/Breadcrumbs'
import { visibleSpecEntries } from '@/utils/visibleSpecifications'
import { SITE_NAME, absoluteUrl } from './siteConfig'

/**
 * Structured-data builders. Every field is taken verbatim from
 * server-provided application data — nothing is inferred, defaulted, or
 * invented (§9/§22). A field the API doesn't provide is omitted, never
 * guessed. The output is a plain object; `<Seo>` serialises it with `<`
 * escaped so a string value can't break out of the `<script>` element.
 */

export interface JsonLdObject {
  '@context': 'https://schema.org'
  '@type': string
  [key: string]: unknown
}

/**
 * schema.org/Product for a PDP. `image`, `description` and `aggregateRating`
 * are included only when real data backs them. `availability` reflects the
 * same variant state the page's "Currently unavailable" badge uses.
 */
export function productJsonLd(product: Product, productPath: string): JsonLdObject {
  const url = absoluteUrl(productPath)

  const images = product.images
    .filter((img) => img.url)
    .sort((a, b) => (a.isPrimary === b.isPrimary ? a.sortOrder - b.sortOrder : a.isPrimary ? -1 : 1))
    .map((img) => img.url)

  const allVariantsUnavailable =
    product.variants.length > 0 && product.variants.every((v) => !v.isAvailable)

  const offer: Record<string, unknown> = {
    '@type': 'Offer',
    price: product.basePrice,
    priceCurrency: 'INR',
    availability: allVariantsUnavailable
      ? 'https://schema.org/OutOfStock'
      : 'https://schema.org/InStock',
    url,
  }

  const data: JsonLdObject = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    url,
    offers: offer,
  }

  if (images.length > 0) {
    data.image = images
  }

  const description = describeProduct(product)
  if (description) {
    data.description = description
  }

  if (product.reviewCount > 0 && product.avgRating) {
    data.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: product.avgRating,
      reviewCount: product.reviewCount,
    }
  }

  return data
}

/** A short factual description from the product's own name and its
 * `specifications` map (the only descriptive data the API carries — there
 * is no `description` field, see types/catalog.ts). Returns null when
 * there's nothing beyond the name to say. */
export function describeProduct(product: Product): string | null {
  const specs = product.specifications
  if (specs && typeof specs === 'object') {
    const parts: string[] = []
    for (const [key, value] of visibleSpecEntries(specs)) {
      if (parts.length >= 4) break
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        const text = String(value).trim()
        if (text.length > 0) parts.push(`${key}: ${text}`)
      }
    }
    if (parts.length > 0) {
      return sanitize(`${product.name}. ${parts.join('. ')}.`)
    }
  }
  return null
}

/**
 * schema.org/BreadcrumbList from the exact `Crumb[]` the visible
 * `<Breadcrumbs>` renders (§10). The final crumb (current page) carries no
 * `item`, matching how it renders as plain text rather than a link.
 */
export function breadcrumbJsonLd(items: Crumb[]): JsonLdObject | null {
  if (items.length < 2) return null
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((crumb, index) => {
      const entry: Record<string, unknown> = {
        '@type': 'ListItem',
        position: index + 1,
        name: crumb.label,
      }
      if (crumb.to) entry.item = absoluteUrl(crumb.to)
      return entry
    }),
  }
}

/** WebSite entity for the home page — enables the site name in results.
 * No SearchAction (there is no stable, documented public search URL
 * contract to point a sitelinks searchbox at). */
export function websiteJsonLd(): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: absoluteUrl('/'),
  }
}

function sanitize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}
