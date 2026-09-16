import { describe, expect, it } from 'vitest'
import { categoryStillImage } from './categoryNavOrder'

describe('categoryStillImage', () => {
  it('returns the Car & Auto catalog stills', () => {
    expect(categoryStillImage('dashboard-photos')).toBe('/catalog/DASHBOARD-PHOTO.jpg')
    expect(categoryStillImage('car-hanging-photos')).toBe('/catalog/CAR-HANGING-PHOTO.jpg')
  })

  it('returns empty for categories without a dedicated still', () => {
    expect(categoryStillImage('mugs')).toBe('')
  })
})
