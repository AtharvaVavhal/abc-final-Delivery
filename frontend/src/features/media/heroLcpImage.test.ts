import { describe, expect, it } from 'vitest'
import {
  HERO_LCP_SIZES,
  heroFallbackSrc,
  heroLcpPreload,
  heroSrcSet,
  localHeroBasename,
  optimizedCloudinaryHeroUrl,
  optimizedHeroUrl,
} from './heroLcpImage'

describe('heroLcpImage', () => {
  it('maps local catalog heroes onto generated AVIF/WebP/JPEG variants', () => {
    expect(localHeroBasename('/catalog/hero-3.jpg')).toBe('hero-3')
    expect(optimizedHeroUrl('/catalog/hero-3.jpg', 768, 'avif')).toBe(
      '/catalog/optimized/hero-3-768.avif',
    )
    expect(heroFallbackSrc('/catalog/hero-3.jpg')).toBe(
      '/catalog/optimized/hero-3-768.jpg',
    )
    expect(heroSrcSet('/catalog/hero-3.jpg', 'avif')).toBe(
      '/catalog/optimized/hero-3-480.avif 480w, /catalog/optimized/hero-3-768.avif 768w, /catalog/optimized/hero-3-1024.avif 1024w, /catalog/optimized/hero-3-1280.avif 1280w',
    )
  })

  it('uses a matching AVIF preload with 100vw sizes for the local LCP hero', () => {
    const preload = heroLcpPreload('/catalog/hero-3.jpg')
    expect(preload.href).toBe('/catalog/optimized/hero-3-768.avif')
    expect(preload.imagesrcset).toBe(heroSrcSet('/catalog/hero-3.jpg', 'avif'))
    expect(preload.imagesizes).toBe(HERO_LCP_SIZES)
    expect(preload.imagesizes).toBe('100vw')
    expect(preload.type).toBe('image/avif')
  })

  it('applies Cloudinary f_auto,q_auto,c_limit instead of local variants', () => {
    const url = 'https://res.cloudinary.com/demo/image/upload/v1/hero.jpg'
    expect(optimizedCloudinaryHeroUrl(url, 768)).toBe(
      'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,c_limit,w_768/v1/hero.jpg',
    )
    expect(optimizedHeroUrl(url, 1024, 'avif')).toContain('f_auto,q_auto,c_limit,w_1024')
    expect(localHeroBasename(url)).toBeNull()
  })
})
