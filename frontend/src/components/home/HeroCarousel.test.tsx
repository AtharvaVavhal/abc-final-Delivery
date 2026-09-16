import { describe, expect, it } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import type { HeroSlide } from '@/services/api/settings'
import { HeroCarousel } from './HeroCarousel'

function slide(overrides: Partial<HeroSlide> = {}): HeroSlide {
  return {
    imageUrl: '',
    headline: 'Headline',
    subtext: 'Subtext',
    ctaText: 'Shop now',
    ctaLink: '/products',
    ...overrides,
  }
}

describe('HeroCarousel — heading hierarchy (UX-14)', () => {
  it('exposes exactly one <h1> (the active slide) even with several slides', () => {
    renderWithProviders(
      <HeroCarousel
        slides={[
          slide({ headline: 'First slide' }),
          slide({ headline: 'Second slide' }),
          slide({ headline: 'Third slide' }),
        ]}
      />,
    )

    const h1s = screen.getAllByRole('heading', { level: 1 })
    expect(h1s).toHaveLength(1)
    expect(h1s[0]).toHaveTextContent('First slide')
  })

  it('renders a single slide headline as the sole <h1>', () => {
    renderWithProviders(<HeroCarousel slides={[slide({ headline: 'Only slide' })]} />)

    expect(screen.getByRole('heading', { level: 1, name: 'Only slide' })).toBeInTheDocument()
  })
})

describe('HeroCarousel — keyboard scope (UX freeze P1)', () => {
  const activeHeadline = () => screen.getByRole('heading', { level: 1 }).textContent

  it('does not intercept Space pressed outside the carousel (page scroll preserved)', () => {
    renderWithProviders(
      <div>
        <button type="button">Elsewhere</button>
        <HeroCarousel slides={[slide({ headline: 'A' }), slide({ headline: 'B' })]} />
      </div>,
    )

    const outside = screen.getByRole('button', { name: 'Elsewhere' })
    // fireEvent returns false only if a listener called preventDefault().
    expect(fireEvent.keyDown(outside, { key: ' ', code: 'Space' })).toBe(true)
    expect(fireEvent.keyDown(document.body, { key: ' ', code: 'Space' })).toBe(true)
  })

  it('does not preventDefault Space pressed on the carousel itself', () => {
    renderWithProviders(<HeroCarousel slides={[slide(), slide()]} />)

    const next = screen.getByRole('button', { name: 'Next slide' })
    expect(fireEvent.keyDown(next, { key: ' ', code: 'Space' })).toBe(true)
  })

  it('ignores arrow keys while the user is typing in a text field', () => {
    renderWithProviders(
      <div>
        <input aria-label="Search" />
        <HeroCarousel slides={[slide({ headline: 'A' }), slide({ headline: 'B' }), slide({ headline: 'C' })]} />
      </div>,
    )

    const input = screen.getByLabelText('Search')
    input.focus()
    fireEvent.keyDown(input, { key: 'ArrowRight' })
    fireEvent.keyDown(input, { key: 'ArrowRight' })

    expect(activeHeadline()).toBe('A')
  })

  it('advances and rewinds with arrow keys when a carousel control has focus', () => {
    renderWithProviders(
      <HeroCarousel
        slides={[slide({ headline: 'A' }), slide({ headline: 'B' }), slide({ headline: 'C' })]}
      />,
    )

    const next = screen.getByRole('button', { name: 'Next slide' })
    next.focus()
    expect(next).not.toBeDisabled()
    expect(activeHeadline()).toBe('A')

    expect(next).not.toBeDisabled()

    fireEvent.keyDown(next, { key: 'ArrowRight' })
    expect(activeHeadline()).toBe('B')

    fireEvent.keyDown(next, { key: 'ArrowLeft' })
    expect(activeHeadline()).toBe('A')
  })

  it('keeps the existing pointer controls working (Next button, Pause toggle)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<HeroCarousel slides={[slide({ headline: 'A' }), slide({ headline: 'B' })]} />)

    expect(activeHeadline()).toBe('A')
    await user.click(screen.getByRole('button', { name: 'Next slide' }))
    expect(activeHeadline()).toBe('B')

    const pause = screen.getByRole('button', { name: 'Pause carousel' })
    expect(pause).toHaveAttribute('aria-pressed', 'true')
    await user.click(pause)
    expect(screen.getByRole('button', { name: 'Play carousel' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })
})
