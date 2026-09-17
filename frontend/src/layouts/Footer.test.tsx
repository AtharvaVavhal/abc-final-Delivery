import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import MockAdapter from 'axios-mock-adapter'
import { apiClient } from '@/services/api/client'
import { renderWithProviders } from '@/test/test-utils'
import { Footer } from './Footer'

function renderFooter() {
  // Footer reads the configured store name (useStoreName → TanStack Query),
  // so it needs the provider stack. No /settings/storeName mock here — the
  // hook falls back to "AB Creations", which is what these tests assert.
  return renderWithProviders(<Footer />)
}

describe('Footer', () => {
  let mock: MockAdapter

  beforeEach(() => {
    mock = new MockAdapter(apiClient)
    mock.onGet('/categories/tree').reply(200, { success: true, data: [] })
    mock.onGet('/settings').reply(200, {
      success: true,
      data: { data: { storeName: 'AB Creations' } },
    })
  })

  afterEach(() => {
    mock.restore()
  })

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

  it('does not show Store Admin copy or an unpublished-contact placeholder', () => {
    const { container } = renderFooter()
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/Store Admin/)
    expect(text).not.toMatch(/Contact details appear here/)
    expect(screen.queryByRole('heading', { name: 'Get in touch' })).not.toBeInTheDocument()
  })

  it('uses the store logo in the footer brand link', () => {
    renderFooter()
    const brand = screen.getByRole('link', { name: 'AB Creations home' })
    expect(brand).toHaveAttribute('href', '/')
    expect(brand.querySelector('img')).toHaveAttribute('src', '/catalog/logo.png')
  })

  it('lists published contact details under Get in touch', async () => {
    mock.onGet('/settings').reply(200, {
      success: true,
      data: {
        data: {
          storeName: 'AB Creations',
          storeContactEmail: 'hello@example.test',
        },
      },
    })

    renderFooter()

    expect(await screen.findByRole('heading', { name: 'Get in touch' })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'hello@example.test' })).toHaveAttribute(
        'href',
        'mailto:hello@example.test',
      )
    })
  })

  it('credits FORGE Technologies without replacing AB Creations branding', () => {
    renderFooter()
    expect(screen.getByText(/Designed & Managed by/)).toBeInTheDocument()
    const credit = screen.getByRole('link', { name: 'FORGE Technologies' })
    expect(credit).toHaveAttribute('href', 'https://forgebuilds.in')
    expect(credit).toHaveAttribute('target', '_blank')
    expect(credit).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByRole('img', { name: 'FORGE Technologies' })).toHaveAttribute(
      'src',
      '/brand/forge/FORGE-horizontal.png',
    )
  })
})
