import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import MockAdapter from 'axios-mock-adapter'
import { apiClient } from './client'
import {
  fetchHomepageSettings,
  fetchStoreLogo,
  fetchStoreName,
  type Banner,
  type HeroSlide,
  type ShowcaseCategory,
} from './settings'

/**
 * Locks `fetchHomepageSettings` to the REAL `GET /settings?keys=…` wire
 * contract, which the frontend previously read at the wrong depth and
 * without deserializing:
 *
 *   { success: true, data: { data: { <key>: "<JSON string>" } } }
 *
 * (the controller returns `{ data: <map> }` and the response interceptor
 * wraps it again — deliberate, e2e-locked on the backend.)
 */

const slide = (overrides: Partial<HeroSlide> = {}): HeroSlide => ({
  imageUrl: 'https://cdn.example.test/a.jpg',
  headline: 'Summer drop',
  subtext: 'Fresh prints for the season',
  ctaText: 'Shop now',
  ctaLink: '/products',
  ...overrides,
})

const banner = (overrides: Partial<Banner> = {}): Banner => ({
  imageUrl: 'https://cdn.example.test/b.jpg',
  title: 'Sitewide sale',
  text: 'Up to 20% off',
  link: '/products',
  ...overrides,
})

const showcaseCategory = (overrides: Partial<ShowcaseCategory> = {}): ShowcaseCategory => ({
  categoryId: 'cat-1',
  imageUrl: 'https://cdn.example.test/c.jpg',
  title: 'Mugs',
  ...overrides,
})

/** The real envelope: settings map nested at data.data. */
function settingsResponse(map: Record<string, string>) {
  return { success: true, data: { data: map } }
}

describe('fetchHomepageSettings — real wire contract', () => {
  let mock: MockAdapter

  beforeEach(() => {
    mock = new MockAdapter(apiClient)
  })

  afterEach(() => {
    mock.restore()
  })

  it('requests chrome and homepage keys from GET /settings', async () => {
    mock.onGet('/settings').reply(200, settingsResponse({}))

    await fetchHomepageSettings()

    const call = mock.history.get.find((r) => r.url === '/settings')
    expect(call?.params).toEqual({
      keys: 'storeName,storeLogo,whatsappNumber,announcement_text,storeContactEmail,storeContactPhone,storeAddress,sellerLegalName,sellerLocality,sellerGstin,sellerPaymentProtected,hero_slides,banners,showcase_categories,brand_story,featured_media',
    })
  })

  // A — valid hero_slides
  it('parses a JSON-string hero_slides value into an array of slides', async () => {
    const slides = [slide({ headline: 'One' }), slide({ headline: 'Two' })]
    mock.onGet('/settings').reply(
      200,
      settingsResponse({ hero_slides: JSON.stringify(slides) }),
    )

    const result = await fetchHomepageSettings()

    expect(result.hero_slides).toEqual(slides)
    expect(result.banners).toBeUndefined()
    expect(result.showcase_categories).toBeUndefined()
  })

  it('parses banners and showcase_categories the same way', async () => {
    const banners = [banner({ title: 'A' }), banner({ title: 'B' })]
    const categories = [showcaseCategory({ title: 'Mugs' }), showcaseCategory({ title: 'Tees' })]
    mock.onGet('/settings').reply(
      200,
      settingsResponse({
        banners: JSON.stringify(banners),
        showcase_categories: JSON.stringify(categories),
      }),
    )

    const result = await fetchHomepageSettings()

    expect(result.banners).toEqual(banners)
    expect(result.showcase_categories).toEqual(categories)
    expect(result.hero_slides).toBeUndefined()
  })

  // B — empty response
  it('returns all-undefined fields when the settings map is empty', async () => {
    mock.onGet('/settings').reply(200, settingsResponse({}))

    const result = await fetchHomepageSettings()

    expect(result).toEqual({
      hero_slides: undefined,
      banners: undefined,
      showcase_categories: undefined,
    })
  })

  // C — malformed JSON
  it('yields undefined for a field whose value is not valid JSON, without throwing', async () => {
    mock.onGet('/settings').reply(
      200,
      settingsResponse({
        hero_slides: '[{"headline":"broken"',
        banners: JSON.stringify([banner()]),
      }),
    )

    const result = await fetchHomepageSettings()

    expect(result.hero_slides).toBeUndefined()
    // A sibling key with valid JSON is unaffected.
    expect(result.banners).toHaveLength(1)
  })

  it('yields undefined when a value parses to valid JSON that is not an array', async () => {
    mock.onGet('/settings').reply(
      200,
      settingsResponse({
        hero_slides: JSON.stringify({ headline: 'not an array' }),
        showcase_categories: JSON.stringify('nope'),
      }),
    )

    const result = await fetchHomepageSettings()

    expect(result.hero_slides).toBeUndefined()
    expect(result.showcase_categories).toBeUndefined()
  })

  it('tolerates the settings map being absent entirely', async () => {
    mock.onGet('/settings').reply(200, { success: true, data: {} })

    const result = await fetchHomepageSettings()

    expect(result).toEqual({
      hero_slides: undefined,
      banners: undefined,
      showcase_categories: undefined,
    })
  })

  it('does not treat an empty-string value as configured content', async () => {
    mock.onGet('/settings').reply(200, settingsResponse({ hero_slides: '' }))

    const result = await fetchHomepageSettings()

    expect(result.hero_slides).toBeUndefined()
  })
})

describe('fetchStoreName — single-key contract (unchanged, regression guard)', () => {
  let mock: MockAdapter

  beforeEach(() => {
    mock = new MockAdapter(apiClient)
  })

  afterEach(() => {
    mock.restore()
  })

  it('reads the value from the single-key envelope shape', async () => {
    mock.onGet('/settings/storeName').reply(200, { success: true, data: { value: 'Atharva Prints' } })

    expect(await fetchStoreName()).toBe('Atharva Prints')
  })

  it('returns null when the value is null', async () => {
    mock.onGet('/settings/storeName').reply(200, { success: true, data: { value: null } })

    expect(await fetchStoreName()).toBeNull()
  })
})

describe('fetchStoreLogo — single-key contract', () => {
  let mock: MockAdapter

  beforeEach(() => {
    mock = new MockAdapter(apiClient)
  })

  afterEach(() => {
    mock.restore()
  })

  it('reads the value from the single-key envelope shape', async () => {
    mock
      .onGet('/settings/storeLogo')
      .reply(200, { success: true, data: { value: 'https://cdn.example/logo.png' } })

    expect(await fetchStoreLogo()).toBe('https://cdn.example/logo.png')
  })
})
