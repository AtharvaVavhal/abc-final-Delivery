import { describe, expect, it } from 'vitest'
import { getStorefrontShell } from './storefront-shell'
import snapshot from './storefront-shell.json' with { type: 'json' }
import { lcpSnapshot } from '@/features/media/heroLcpImage'

describe('getStorefrontShell', () => {
  it('is disabled under Vitest so unit tests keep using API mocks', () => {
    expect(getStorefrontShell()).toBeNull()
  })
})

describe('storefront-shell.json (build-time snapshot of live public settings)', () => {
  it('contains the configured AB Creations chrome, not invented copy', () => {
    expect(snapshot.settings.storeName).toBe('AB Creations')
    expect(snapshot.settings.homepage.hero_slides?.[0]?.headline).toBe(
      'Acrylic caricatures from your photo',
    )
    expect(snapshot.settings.homepage.hero_slides?.[0]?.imageUrl).toBe(
      '/catalog/hero-3.jpg',
    )
    expect(snapshot.lcp?.sourceUrl).toBe('/catalog/hero-3.jpg')
    expect(snapshot.lcp?.href).toBe('/catalog/optimized/hero-3-768.avif')
    expect(snapshot.lcp?.sizes).toBe('100vw')
    expect(snapshot.lcp?.srcsetAvif).toContain('/catalog/optimized/hero-3-480.avif 480w')
    expect(snapshot.lcp?.srcsetAvif).toContain('/catalog/optimized/hero-3-1280.avif 1280w')
    expect(snapshot.categories.some((category) => category.slug === 'acrylic-gifts')).toBe(
      true,
    )
    expect(snapshot.deploymentKey).toBe('ab-creations-storefront')
    expect(snapshot.lcp).toEqual(lcpSnapshot('/catalog/hero-3.jpg'))
  })
})
