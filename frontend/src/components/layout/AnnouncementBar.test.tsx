import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import MockAdapter from 'axios-mock-adapter'
import { apiClient } from '@/services/api/client'
import { renderWithProviders } from '@/test/test-utils'
import { AnnouncementBar, parseAnnouncementSegments } from './AnnouncementBar'
import styles from './AnnouncementBar.module.css'

function settingsReply(map: Record<string, string>) {
  return [200, { success: true, data: { data: map } }] as const
}

describe('parseAnnouncementSegments', () => {
  it('splits pipe-separated messages and trims each one', () => {
    expect(parseAnnouncementSegments('Free shipping | Extra 12% OFF | New drops')).toEqual([
      'Free shipping',
      'Extra 12% OFF',
      'New drops',
    ])
  })

  it('keeps a single configured line as one segment', () => {
    expect(parseAnnouncementSegments('Free shipping this week')).toEqual([
      'Free shipping this week',
    ])
  })

  it('drops blank pieces', () => {
    expect(parseAnnouncementSegments('  | Hello |  |  ')).toEqual(['Hello'])
  })
})

describe('AnnouncementBar', () => {
  let mock: MockAdapter

  beforeEach(() => {
    mock = new MockAdapter(apiClient)
  })
  afterEach(() => {
    mock.restore()
  })

  it('renders nothing while the setting is loading', () => {
    mock.onGet('/settings').reply(() => new Promise(() => {}))
    const { container } = renderWithProviders(<AnnouncementBar />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when announcement text is blank', async () => {
    mock.onGet('/settings').reply(200, { success: true, data: { data: { announcement_text: '' } } })
    const { container } = renderWithProviders(<AnnouncementBar />)
    await waitFor(() => {
      expect(mock.history.get.length).toBeGreaterThan(0)
    })
    expect(screen.queryByRole('region', { name: 'Store announcements' })).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the setting request fails', async () => {
    mock.onGet('/settings').reply(500)
    const { container } = renderWithProviders(<AnnouncementBar />)
    await waitFor(() => {
      expect(mock.history.get.length).toBeGreaterThan(0)
    })
    expect(screen.queryByRole('region', { name: 'Store announcements' })).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })

  it('renders configured copy in a duplicated marquee track with no close control', async () => {
    mock.onGet('/settings').reply(
      ...settingsReply({ announcement_text: 'Free shipping at ₹1,000+ | Extra 12% OFF' }),
    )
    const { container } = renderWithProviders(<AnnouncementBar />)

    expect(await screen.findByRole('region', { name: 'Store announcements' })).toBeInTheDocument()
    expect(screen.getByText('Free shipping at ₹1,000+. Extra 12% OFF')).toHaveClass('srOnly')
    expect(container.querySelector(`.${styles.track}`)).not.toBeNull()
    expect(container.querySelectorAll('[data-duplicate="true"]')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Dismiss announcement' })).not.toBeInTheDocument()
    expect(container.textContent).not.toMatch(/UvPixel/i)
  })
})
