import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/test-utils'
import { CategoryStoryBar, type StoryCategory } from './CategoryStoryBar'

const STORIES: StoryCategory[] = [
  { id: 'a', title: 'Cutout', image: '/a.jpg', href: '/products?categoryId=a' },
  { id: 'b', title: 'Mugs', image: '/b.jpg', href: '/products?categoryId=b' },
  { id: 'c', title: 'Logo', image: '/c.jpg', href: '/products' },
]

describe('CategoryStoryBar', () => {
  it('links each circle to its category collection', () => {
    renderWithProviders(<CategoryStoryBar stories={STORIES} />)

    expect(screen.getByRole('navigation', { name: 'Shop by category' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Cutout/ })).toHaveAttribute(
      'href',
      '/products?categoryId=a',
    )
    expect(screen.getByRole('link', { name: /Mugs/ })).toHaveAttribute(
      'href',
      '/products?categoryId=b',
    )
  })

  it('does not invent a play dialog — the circle itself is the link', () => {
    renderWithProviders(
      <CategoryStoryBar
        stories={[
          {
            id: 'a',
            title: 'Cutout',
            image: '/a.jpg',
            href: '/products?categoryId=a',
            video: '/videos/cutout.mp4',
          },
        ]}
      />,
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Cutout/ })).toBeInTheDocument()
  })
})
