import { describe, expect, it } from 'vitest'
import { applyAdminSettingToStorefront } from './applyAdminSettingToStorefront'
import type { AdminSettingView, StorefrontPublicSettings } from '@/services/api/settings'

const current: StorefrontPublicSettings = {
  storeName: 'AB Creations',
  storeLogo: 'https://cdn.example/old-logo.png',
  whatsappNumber: null,
  announcement_text: '',
  contact: { email: '', phone: '', address: '' },
  seller: {
    legalName: 'GOURAV KUMAR ABHAY SINGH',
    locality: 'Golden City, Magistrate Lane, Maharajpura, Gwalior, MP, India',
    gstin: '23EQZPS2886B1Z7',
    paymentProtected: true,
  },
  homepage: {},
}

function view(key: string, value: string): AdminSettingView {
  return {
    key,
    label: key,
    description: '',
    kind: 'text',
    value,
    default: '',
  }
}

describe('applyAdminSettingToStorefront', () => {
  it('replaces the cached storefront logo URL', () => {
    const next = applyAdminSettingToStorefront(
      current,
      view('storeLogo', 'https://cdn.example/new-logo.png'),
    )
    expect(next?.storeLogo).toBe('https://cdn.example/new-logo.png')
    expect(next?.storeName).toBe('AB Creations')
  })

  it('seeds a logo URL when the storefront cache is empty', () => {
    const next = applyAdminSettingToStorefront(
      undefined,
      view('storeLogo', 'https://cdn.example/x.png'),
    )
    expect(next.storeLogo).toBe('https://cdn.example/x.png')
  })
})
