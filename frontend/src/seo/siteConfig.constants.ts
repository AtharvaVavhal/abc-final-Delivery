/**
 * Plain constants with no `import.meta.env` access, so this module is safe
 * to import from both browser code (via siteConfig.ts) and the Vite config
 * (Node context, where import.meta.env doesn't exist).
 */
export const SITE_NAME = 'AB Creations'

/**
 * Local/dev fallback origin for canonical URLs, og:url, JSON-LD, robots, and
 * sitemap. Production MUST set VITE_SITE_URL to the real AB Creations domain
 * — never ship printforge.in as the canonical host.
 */
export const DEFAULT_SITE_URL = 'http://localhost:5173'
