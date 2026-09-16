import { useLayoutEffect } from 'react'
import { SITE_NAME, absoluteUrl, clampDescription, pageTitle } from './siteConfig'
import type { JsonLdObject } from './jsonLd'

interface SeoProps {
  /** The page name — turned into "<name> | AB Creations". Pass "" for the
   * home page (renders just "AB Creations"). */
  title: string
  description?: string
  /** Root-relative path (with query string if it's part of the canonical
   * identity). Omitted → no canonical / og:url is emitted, which is the
   * right call for filtered/searched listing URLs (§4/§14). */
  canonicalPath?: string
  /** Private / utility routes set this. When true, no canonical is emitted
   * and robots is `noindex, nofollow` (§5). */
  noindex?: boolean
  ogType?: 'website' | 'article' | 'product'
  /** Absolute URL of a real image only. Never a placeholder (§8). */
  ogImage?: string
  /** One structured-data object or an array of them (§9/§10). */
  jsonLd?: JsonLdObject | JsonLdObject[]
}

function upsertMeta(attr: 'name' | 'property', key: string, content: string | undefined): void {
  const nodes = [...document.head.querySelectorAll(`meta[${attr}="${key}"]`)]
  if (!content) {
    for (const node of nodes) node.remove()
    return
  }
  const el =
    (nodes[0] as HTMLMetaElement | undefined) ?? document.head.appendChild(document.createElement('meta'))
  el.setAttribute(attr, key)
  el.setAttribute('content', content)
  for (const extra of nodes.slice(1)) extra.remove()
}

function upsertCanonical(href: string | undefined): void {
  const nodes = [...document.head.querySelectorAll('link[rel="canonical"]')]
  if (!href) {
    for (const node of nodes) node.remove()
    return
  }
  const el =
    (nodes[0] as HTMLLinkElement | undefined) ?? document.head.appendChild(document.createElement('link'))
  el.setAttribute('rel', 'canonical')
  el.setAttribute('href', href)
  for (const extra of nodes.slice(1)) extra.remove()
}

/**
 * Route-level document metadata. Title and JSON-LD still use React 19's
 * native head hoisting. Description / OG / Twitter / canonical are upserted
 * onto the tags already in index.html so hydration does not duplicate them.
 *
 * SPA caveat (§16): these tags are applied after the JS bundle runs.
 * Googlebot renders the page before indexing so it sees the final values,
 * but non-rendering crawlers and social scrapers see only index.html's
 * static defaults. A pre-render / SSR step would be needed to change that
 * and is explicitly out of scope for this phase.
 */
export function Seo({
  title,
  description,
  canonicalPath,
  noindex = false,
  ogType = 'website',
  ogImage,
  jsonLd,
}: SeoProps) {
  const fullTitle = pageTitle(title)
  const desc = description ? clampDescription(description) : undefined
  const canonicalUrl =
    !noindex && canonicalPath ? absoluteUrl(canonicalPath) : undefined
  const robots = noindex ? 'noindex, nofollow' : 'index, follow'
  const twitterCard = ogImage ? 'summary_large_image' : 'summary'

  const blocks = jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : []

  useLayoutEffect(() => {
    upsertMeta('name', 'robots', robots)
    upsertMeta('name', 'description', desc)
    upsertCanonical(canonicalUrl)
    upsertMeta('property', 'og:site_name', SITE_NAME)
    upsertMeta('property', 'og:type', ogType)
    upsertMeta('property', 'og:title', fullTitle)
    upsertMeta('property', 'og:description', desc)
    upsertMeta('property', 'og:url', canonicalUrl)
    upsertMeta('property', 'og:image', ogImage)
    upsertMeta('name', 'twitter:card', twitterCard)
    upsertMeta('name', 'twitter:title', fullTitle)
    upsertMeta('name', 'twitter:description', desc)
    upsertMeta('name', 'twitter:image', ogImage)
  }, [robots, desc, canonicalUrl, ogType, fullTitle, ogImage, twitterCard])

  return (
    <>
      <title>{fullTitle}</title>
      {blocks.map((block, i) => (
        <script
          key={i}
          type="application/ld+json"
          // JSON.stringify escapes quotes; escaping "<" additionally closes
          // the only remaining break-out vector (a literal "</script>" in a
          // string value). The data itself is server-validated app data.
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(block).replace(/</g, '\\u003c'),
          }}
        />
      ))}
    </>
  )
}
