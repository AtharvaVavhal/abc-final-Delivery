import { describe, expect, it } from 'vitest'
import type { Location } from 'react-router-dom'
import { postAuthDestination } from './postAuthDestination'

function loc(state: unknown): Location {
  return { pathname: '/login', search: '', hash: '', state, key: 'x' }
}

describe('postAuthDestination', () => {
  it.each(['https://evil.test', '//evil.test', '/\\evil.test', '/ bad'])(
    'rejects an unsafe destination %s',
    (pathname) => {
      expect(postAuthDestination(loc({ from: { pathname } }))).toBe('/')
    },
  )
  it('returns the attempted path + query when a `from` location is present', () => {
    expect(
      postAuthDestination(
        loc({ from: { pathname: '/products/mug', search: '?variant=1' } }),
      ),
    ).toBe('/products/mug?variant=1')
  })

  it('returns the path alone when there is no search', () => {
    expect(postAuthDestination(loc({ from: { pathname: '/checkout' } }))).toBe(
      '/checkout',
    )
  })

  it('falls back to home when there is no `from`', () => {
    expect(postAuthDestination(loc(null))).toBe('/')
    expect(postAuthDestination(loc({}))).toBe('/')
  })
})
