import { useStorefrontPublicSettings } from './useStorefrontPublicSettings'

/** Bundled mark in `frontend/public/catalog/logo.png`. Used until an admin
 * uploads a replacement in Settings, and whenever the public setting is
 * blank or unreachable. */
export const STORE_LOGO_FALLBACK = '/catalog/logo.png'

export function useStoreLogo(): string {
  const { data } = useStorefrontPublicSettings()
  const resolved = data?.storeLogo?.trim()
  return resolved && resolved.length > 0 ? resolved : STORE_LOGO_FALLBACK
}
