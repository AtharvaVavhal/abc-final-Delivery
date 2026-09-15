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

/**
 * Route-level document metadata, rendered with React 19's native support
 * for `<title>` / `<meta>` / `<link>` in component output (which hoists
 * them into `<head>` and tears them down on unmount) — no head-management
 * dependency, no second system competing with the tags already in
 * index.html.
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

  const blocks = jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : []

  return (
    <>
      <title>{fullTitle}</title>
      <meta
        name="robots"
        content={noindex ? 'noindex, nofollow' : 'index, follow'}
      />
      {desc && <meta name="description" content={desc} />}
      {canonicalUrl && <link rel="canonical" href={canonicalUrl} />}

      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:type" content={ogType} />
      <meta property="og:title" content={fullTitle} />
      {desc && <meta property="og:description" content={desc} />}
      {canonicalUrl && <meta property="og:url" content={canonicalUrl} />}
      {ogImage && <meta property="og:image" content={ogImage} />}

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
