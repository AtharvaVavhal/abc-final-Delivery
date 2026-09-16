import type { Product } from '@/types/catalog'
import type { Crumb } from '@/components/ui/Breadcrumbs'
import { productDetailPath } from '@/constants/routes'
import {
  SELLER_GSTIN_DEFAULT,
  SELLER_LEGAL_NAME_DEFAULT,
  SELLER_LOCALITY_DEFAULT,
} from '@/constants/sellerIdentity'
import { visibleSpecEntries } from '@/utils/visibleSpecifications'
import { SITE_NAME, absoluteUrl } from './siteConfig'
import { defaultShareImage } from './shareImage'

/**
 * Structured-data builders. Fields come from real store, product, or
 * seller data — never invented SKUs, ratings, or prices.
 */

export interface JsonLdObject {
  '@context': 'https://schema.org'
  '@type': string
  [key: string]: unknown
}

function storeBrand() {
  return {
    '@type': 'Brand',
    name: SITE_NAME,
  }
}

/** Organization / LocalBusiness for AB Creations — name, address, GSTIN,
 * and logo are the same values the storefront already publishes. */
export function organizationJsonLd(): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    alternateName: 'ABC Manufactures',
    url: absoluteUrl('/'),
    logo: defaultShareImage(),
    legalName: SELLER_LEGAL_NAME_DEFAULT,
    taxID: SELLER_GSTIN_DEFAULT,
    address: {
      '@type': 'PostalAddress',
      streetAddress: SELLER_LOCALITY_DEFAULT,
      addressLocality: 'Gwalior',
      addressRegion: 'Madhya Pradesh',
      addressCountry: 'IN',
    },
    areaServed: {
      '@type': 'Country',
      name: 'India',
    },
  }
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
    seller: { '@type': 'Organization', name: SITE_NAME },
  }

  const data: JsonLdObject = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    url,
    brand: storeBrand(),
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

/** CollectionPage + ItemList for an indexable catalog listing. */
export function collectionJsonLd(input: {
  name: string
  path: string
  products: Pick<Product, 'name' | 'slug'>[]
  total: number
  page: number
  limit: number
}): JsonLdObject {
  const start = Math.max(0, (input.page - 1) * input.limit)
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: input.name,
    url: absoluteUrl(input.path),
    isPartOf: {
      '@type': 'WebSite',
      name: SITE_NAME,
      url: absoluteUrl('/'),
    },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: input.total,
      itemListElement: input.products.map((product, index) => ({
        '@type': 'ListItem',
        position: start + index + 1,
        url: absoluteUrl(productDetailPath(product.slug)),
        name: product.name,
      })),
    },
  }
}

/** WebSite entity for the home page — enables the site name in results.
 * Search results stay noindex, so this does not advertise a SearchAction. */
export function websiteJsonLd(): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: absoluteUrl('/'),
    publisher: organizationJsonLd(),
  }
}

function sanitize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}
