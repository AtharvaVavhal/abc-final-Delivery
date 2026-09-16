import type { AdminSettingView, StorefrontPublicSettings } from '@/services/api/settings'

const EMPTY_STOREFRONT_SETTINGS: StorefrontPublicSettings = {
  storeName: null,
  storeLogo: null,
  whatsappNumber: null,
  announcement_text: '',
  contact: { email: '', phone: '', address: '' },
  seller: {
    legalName: '',
    locality: '',
    gstin: '',
    paymentProtected: true,
  },
  homepage: {},
}

function parseJsonList(value: string): unknown[] | undefined {
  if (!value.trim()) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Apply one admin PATCH onto the public storefront settings cache so the
 * navbar/footer update immediately instead of keeping the build snapshot. */
export function applyAdminSettingToStorefront(
  current: StorefrontPublicSettings | undefined,
  updated: AdminSettingView,
): StorefrontPublicSettings {
  const base = current ?? EMPTY_STOREFRONT_SETTINGS
  const seller = base.seller ?? EMPTY_STOREFRONT_SETTINGS.seller
  const contact = base.contact ?? EMPTY_STOREFRONT_SETTINGS.contact
  const homepage = base.homepage ?? {}

  switch (updated.key) {
    case 'storeLogo':
      return { ...base, storeLogo: updated.value }
    case 'storeName':
      return { ...base, storeName: updated.value }
    case 'announcement_text':
      return { ...base, announcement_text: updated.value }
    case 'whatsappNumber':
      return { ...base, whatsappNumber: updated.value }
    case 'storeContactEmail':
      return { ...base, contact: { ...contact, email: updated.value } }
    case 'storeContactPhone':
      return { ...base, contact: { ...contact, phone: updated.value } }
    case 'storeAddress':
      return { ...base, contact: { ...contact, address: updated.value } }
    case 'sellerLegalName':
      return { ...base, seller: { ...seller, legalName: updated.value } }
    case 'sellerLocality':
      return { ...base, seller: { ...seller, locality: updated.value } }
    case 'sellerGstin':
      return { ...base, seller: { ...seller, gstin: updated.value } }
    case 'sellerPaymentProtected':
      return {
        ...base,
        seller: { ...seller, paymentProtected: updated.value === 'true' },
      }
    case 'brand_story':
      return {
        ...base,
        homepage: { ...homepage, brand_story: updated.value.trim() || undefined },
      }
    case 'hero_slides':
      return {
        ...base,
        homepage: {
          ...homepage,
          hero_slides: parseJsonList(
            updated.value,
          ) as StorefrontPublicSettings['homepage']['hero_slides'],
        },
      }
    default:
      return base
  }
}
