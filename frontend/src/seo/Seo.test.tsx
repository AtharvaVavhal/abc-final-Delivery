import { describe, expect, it } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { Seo } from './Seo'

/** Read a hoisted <meta>/<link> from the live document head. */
function meta(selector: string): string | null {
  return document.head.querySelector(selector)?.getAttribute('content') ?? null
}
function link(rel: string): string | null {
  return document.head.querySelector(`link[rel="${rel}"]`)?.getAttribute('href') ?? null
}
function jsonLdBlocks(): Record<string, unknown>[] {
  return [...document.querySelectorAll('script[type="application/ld+json"]')].map(
    (el) => JSON.parse(el.textContent ?? 'null') as Record<string, unknown>,
  )
}

describe('Seo', () => {
  it('sets an indexable page title, description, canonical and Open Graph tags', () => {
    render(
      <Seo
        title="About"
        description={'  Line one.   Line two.  '}
        canonicalPath="/about"
        ogType="article"
      />,
    )

    expect(document.title).toBe('About | AB Creations')
    expect(meta('meta[name="robots"]')).toBe('index, follow')
    expect(meta('meta[name="description"]')).toBe('Line one. Line two.')
    expect(link('canonical')).toBe('http://localhost:5173/about')
    expect(meta('meta[property="og:type"]')).toBe('article')
    expect(meta('meta[property="og:title"]')).toBe('About | AB Creations')
    expect(meta('meta[property="og:url"]')).toBe('http://localhost:5173/about')
    expect(meta('meta[property="og:site_name"]')).toBe('AB Creations')
    cleanup()
  })

  it('renders just "AB Creations" for the home page (empty title)', () => {
    render(<Seo title="" canonicalPath="/" />)
    expect(document.title).toBe('AB Creations')
    cleanup()
  })

  it('marks private routes noindex and emits no canonical / og:url', () => {
    render(<Seo title="Your cart" noindex canonicalPath="/cart" />)

    expect(document.title).toBe('Your cart | AB Creations')
    expect(meta('meta[name="robots"]')).toBe('noindex, nofollow')
    expect(link('canonical')).toBeNull()
    expect(meta('meta[property="og:url"]')).toBeNull()
    cleanup()
  })

  it('uses a default share image on indexable pages when none is supplied', () => {
    render(<Seo title="X" canonicalPath="/x" />)
    expect(meta('meta[property="og:image"]')).toBe('http://localhost:5173/catalog/logo.png')
    cleanup()

    render(<Seo title="X" canonicalPath="/x" ogImage="https://cdn/real.png" />)
    expect(meta('meta[property="og:image"]')).toBe('https://cdn/real.png')
    cleanup()
  })

  it('omits og:image on noindex pages', () => {
    render(<Seo title="Your cart" noindex />)
    expect(document.head.querySelector('meta[property="og:image"]')).toBeNull()
    cleanup()
  })

  it('clamps an over-long description to <=160 chars with an ellipsis', () => {
    render(<Seo title="X" description={'word '.repeat(60)} />)
    const desc = meta('meta[name="description"]') ?? ''
    expect(desc.length).toBeLessThanOrEqual(160)
    expect(desc.endsWith('…')).toBe(true)
    cleanup()
  })

  it('serialises JSON-LD as valid JSON with "<" escaped', () => {
    render(
      <Seo
        title="X"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: 'Evil </script><script>alert(1)</script>',
        }}
      />,
    )
    const raw = document.querySelector('script[type="application/ld+json"]')?.textContent ?? ''
    expect(raw).not.toContain('</script>')
    expect(raw).toContain('\\u003c')
    const parsed = jsonLdBlocks()[0]
    expect(parsed['@type']).toBe('Product')
    expect(parsed.name).toContain('alert(1)')
    cleanup()
  })

  it('swaps metadata cleanly on route change and tears it down on unmount', () => {
    const { rerender, unmount } = render(<Seo title="Page A" description="A" canonicalPath="/a" />)
    expect(document.title).toBe('Page A | AB Creations')
    expect(link('canonical')).toBe('http://localhost:5173/a')

    rerender(<Seo title="Page B" noindex />)
    expect(document.title).toBe('Page B | AB Creations')
    expect(link('canonical')).toBeNull()
    expect(meta('meta[name="robots"]')).toBe('noindex, nofollow')

    unmount()
    expect(document.head.querySelectorAll('title')).toHaveLength(0)
  })

  it('updates an existing index.html description tag instead of appending a duplicate', () => {
    const existing = document.createElement('meta')
    existing.setAttribute('name', 'description')
    existing.setAttribute('content', 'Static shell description')
    document.head.appendChild(existing)

    render(<Seo title="" description="Route description" canonicalPath="/" />)

    const tags = document.head.querySelectorAll('meta[name="description"]')
    expect(tags).toHaveLength(1)
    expect(tags[0]?.getAttribute('content')).toBe('Route description')
    cleanup()
  })
})
