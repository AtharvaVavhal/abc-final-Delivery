import { describe, expect, it } from 'vitest'
import { categoryDescription, HOME_DESCRIPTION, HOME_TITLE } from './pageCopy'

describe('pageCopy', () => {
  it('keeps the home title and description inside a typical SERP budget', () => {
    expect(HOME_TITLE.length).toBeGreaterThan(10)
    expect(HOME_DESCRIPTION.length).toBeLessThanOrEqual(160)
    expect(HOME_DESCRIPTION).toContain('Gwalior')
  })

  it('uses specific copy for known categories and a Gwalior fallback otherwise', () => {
    expect(categoryDescription('Corporate Signage', 'corporate-signage')).toContain('reception boards')
    expect(categoryDescription('Widget Packs', 'widget-packs')).toContain('Widget Packs')
    expect(categoryDescription('Widget Packs', 'widget-packs')).toContain('Gwalior')
  })
})
