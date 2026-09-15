import { describe, expect, it } from 'vitest'
import { parseHeroSlides } from './HeroSlidesSettings'

describe('parseHeroSlides', () => {
  it('returns an empty list for blank or invalid JSON', () => {
    expect(parseHeroSlides('')).toEqual([])
    expect(parseHeroSlides('{"headline":"nope"}')).toEqual([])
    expect(parseHeroSlides('[{"headline":"broken"')).toEqual([])
  })

  it('reads the storefront slide shape', () => {
    expect(
      parseHeroSlides(
        JSON.stringify([
          {
            imageUrl: '/catalog/hero-3.jpg',
            headline: 'Acrylic',
            subtext: 'Made to order',
            ctaText: 'Shop',
            ctaLink: '/products',
          },
        ]),
      ),
    ).toEqual([
      {
        imageUrl: '/catalog/hero-3.jpg',
        headline: 'Acrylic',
        subtext: 'Made to order',
        ctaText: 'Shop',
        ctaLink: '/products',
      },
    ])
  })
})
