import { describe, expect, it } from 'vitest'
import { formatCategoryName } from './formatCategoryName'

describe('formatCategoryName', () => {
  it('corrects "name plats" and variants to "Name Plates"', () => {
    expect(formatCategoryName('name plats')).toBe('Name Plates')
    expect(formatCategoryName('name plat')).toBe('Name Plates')
    expect(formatCategoryName('plats')).toBe('Name Plates')
  })

  it('corrects "logo" to "Logo"', () => {
    expect(formatCategoryName('logo')).toBe('Logo')
  })

  it('formats "mugs" to "Mugs" and "card" to "Business Cards"', () => {
    expect(formatCategoryName('mugs')).toBe('Mugs')
    expect(formatCategoryName('card')).toBe('Business Cards')
    expect(formatCategoryName('t-shirts')).toBe('T-Shirts')
  })

  it('handles empty or null gracefully', () => {
    expect(formatCategoryName('')).toBe('')
    expect(formatCategoryName(null)).toBe('')
    expect(formatCategoryName(undefined)).toBe('')
  })

  it('capitalizes lowercase generic category names', () => {
    expect(formatCategoryName('acrylic signage')).toBe('Acrylic Signage')
  })
})
