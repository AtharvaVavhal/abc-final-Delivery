import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/test-utils'
import { Footer } from './Footer'

function renderFooter() {
  // Footer reads the configured store name (useStoreName → TanStack Query),
  // so it needs the provider stack. No /settings/storeName mock here — the
  // hook falls back to "AB Creations", which is what these tests assert.
  return renderWithProviders(<Footer />)
}

describe('Footer', () => {
  it('links the real legal and company pages', () => {
    renderFooter()
    const expected: [string, string][] = [
      ['About', '/about'],
      ['Contact', '/contact'],
      ['Search', '/products'],
      ['Privacy', '/privacy'],
      ['Terms', '/terms'],
      ['Refund Policy', '/refund-policy'],
      ['All products', '/products'],
    ]
    for (const [name, href] of expected) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', href)
    }
  })

  it('does not fabricate business contact details, social accounts, or certifications', () => {
    const { container } = renderFooter()
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/\+91|\bphone\b|@printforge\.(com|in)/i)
    expect(text).not.toMatch(/facebook|instagram|twitter|linkedin|youtube/i)
    expect(text).not.toMatch(/ISO\s?\d|PCI|certified|GSTIN/i)
    expect(screen.queryByRole('link', { name: /facebook|instagram|twitter/i })).not.toBeInTheDocument()
  })
})
