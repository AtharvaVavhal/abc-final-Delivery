import { describe, expect, it } from 'vitest'
import { visibleSpecEntries } from './visibleSpecifications'

describe('visibleSpecEntries', () => {
  it('drops Source and Listing provenance while keeping real specs', () => {
    expect(
      visibleSpecEntries({
        Source: 'AB Creations listing on abcmanufactures.com',
        Listing:
          'https://www.abcmanufactures.com/products/identica-corporate-signage-directional-signage-board-1500-00-piece',
        Material: 'Acrylic',
        Shape: 'Rectangular',
      }),
    ).toEqual([
      ['Material', 'Acrylic'],
      ['Shape', 'Rectangular'],
    ])
  })

  it('returns an empty list when there are no customer-facing specs', () => {
    expect(visibleSpecEntries(null)).toEqual([])
    expect(visibleSpecEntries({})).toEqual([])
    expect(
      visibleSpecEntries({
        Source: 'AB Creations listing on abcmanufactures.com',
        Listing: 'https://www.abcmanufactures.com/products/ceramic-mug',
      }),
    ).toEqual([])
  })
})
