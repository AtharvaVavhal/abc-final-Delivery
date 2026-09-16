import { describe, expect, it } from 'vitest'
import { NEWEST_PRODUCTS_QUERY, storefrontProductListParams } from './query'

describe('storefrontProductListParams', () => {
  it('reuses the shared newest-products query for unfiltered homepage rails', () => {
    expect(storefrontProductListParams({ sort: 'newest' }, 8)).toBe(NEWEST_PRODUCTS_QUERY)
    expect(storefrontProductListParams({ sort: 'newest', limit: 12 }, 12)).toBe(
      NEWEST_PRODUCTS_QUERY,
    )
  })

  it('keeps filtered catalog reads on their own query key', () => {
    expect(
      storefrontProductListParams({ sort: 'newest', categoryId: 'cat-1' }, 12),
    ).toEqual({ limit: 12, sort: 'newest', categoryId: 'cat-1' })
    expect(
      storefrontProductListParams({ sort: 'rating_desc', minRating: 4 }, 12),
    ).toEqual({ limit: 12, sort: 'rating_desc', minRating: 4 })
  })
})
