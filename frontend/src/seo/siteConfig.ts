import { DEFAULT_SITE_URL, SITE_NAME } from './siteConfig.constants'

/**
 * Single source of truth for SEO-facing site identity.
 *
 * Production MUST set `VITE_SITE_URL` to the live AB Creations origin.
 * When unset, `DEFAULT_SITE_URL` is the local Vite origin so crawler tags
 * never fall back to printforge.in.
 */
export { SITE_NAME, DEFAULT_SITE_URL }

function resolveSiteUrl(): string {
  const configured = import.meta.env.VITE_SITE_URL?.trim()
  const raw = configured && configured.length > 0 ? configured : DEFAULT_SITE_URL
  return raw.replace(/\/+$/, '')
}

export const SITE_URL = resolveSiteUrl()

/** Join a root-relative path onto the site origin. Query strings are kept;
 * a hash is dropped (never part of a canonical URL). */
export function absoluteUrl(pathAndQuery: string): string {
  const path = pathAndQuery.split('#')[0]
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

/** `<title>` text: "<page> | AB Creations", or just "AB Creations" for the
 * home page (passing an empty string). */
export function pageTitle(page?: string): string {
  return page && page.trim().length > 0 ? `${page.trim()} | ${SITE_NAME}` : SITE_NAME
}

/** Collapse whitespace/newlines and hard-cap length so a description built
 * from real page or product copy never becomes an unbounded blob (§3). */
export function clampDescription(text: string, max = 160): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max - 1).trimEnd()}…`
}
