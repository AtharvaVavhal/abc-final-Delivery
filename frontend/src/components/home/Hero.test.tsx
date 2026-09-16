import { act, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/test-utils'
import { Hero, type HeroSlide } from './Hero'

function slide(headline: string, id: string): HeroSlide {
  return {
    id,
    image: '/catalog/hero-1.jpg',
    alt: headline,
    eyebrow: '',
    headline,
    subtext: '',
    ctaText: 'Shop',
    ctaLink: '/products',
  }
}

function mockMatchMedia(reducedMotion: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: reducedMotion && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

describe('Hero autoplay', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockMatchMedia(false)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('advances slides on an interval even while the pointer is over the hero', () => {
    renderWithProviders(
      <Hero slides={[slide('First', 'a'), slide('Second', 'b')]} />,
    )

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('First')

    const hero = screen.getByLabelText('Promotional hero')
    act(() => {
      hero.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
      vi.advanceTimersByTime(6500)
    })

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Second')
  })

  it('still autoplays when the OS prefers reduced motion', () => {
    mockMatchMedia(true)
    renderWithProviders(
      <Hero slides={[slide('First', 'a'), slide('Second', 'b')]} />,
    )

    act(() => {
      vi.advanceTimersByTime(6500)
    })

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Second')
  })

  it('keeps slide controls inside the image stage so copy is not covered', () => {
    renderWithProviders(
      <Hero slides={[slide('First', 'a'), slide('Second', 'b')]} />,
    )
    const hero = screen.getByLabelText('Promotional hero')
    const stage = hero.querySelector('[class*="stage"]')
    expect(stage).toContainElement(screen.getByRole('button', { name: 'Previous slide' }))
    expect(stage).toContainElement(screen.getByRole('button', { name: 'Next slide' }))
    expect(stage).toContainElement(screen.getByRole('tablist', { name: 'Hero slides' }))
  })
})
