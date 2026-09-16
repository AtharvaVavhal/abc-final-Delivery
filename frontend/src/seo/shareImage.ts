import { getStorefrontShell } from '@/generated/storefront-shell'
import { STORE_LOGO_FALLBACK } from '@/hooks/useStoreLogo'
import { absoluteUrl } from './siteConfig'

/** Absolute image used for OG/Twitter when a page has no product photo.
 * Prefers the store logo from the public storefront snapshot. */
export function defaultShareImage(): string {
  const logo = getStorefrontShell()?.settings?.storeLogo?.trim()
  if (logo && /^https?:\/\//i.test(logo)) return logo
  if (logo && logo.startsWith('/')) return absoluteUrl(logo)
  return absoluteUrl(STORE_LOGO_FALLBACK)
}
