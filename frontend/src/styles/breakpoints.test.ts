import { describe, expect, it } from 'vitest'

/**
 * UX-16 guard: keep the storefront's responsive breakpoint system
 * consistent. The canonical scale is documented in `tokens.css`
 * (sm 480 / md 640 / aside 720 / lg 768 / xl 1024, plus three
 * deliberately component-specific values). CSS custom properties can't be
 * used in `@media`, so these tests are what stop the literals from drifting
 * back into a dozen slightly-different values.
 *
 * Files are pulled in with Vite's `import.meta.glob` (`?raw`) so no Node
 * `fs`/`path` types are needed under the app tsconfig.
 */

// The admin UI is frozen and out of scope for storefront UX work.
const cssModules = import.meta.glob<string>(['/src/**/*.module.css', '!/src/**/admin/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

const globalCss = import.meta.glob<string>(['/src/styles/tokens.css', '/src/styles/global.css'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

const tsFiles = import.meta.glob<string>(['/src/**/*.ts', '/src/**/*.tsx', '!/src/**/*.test.*'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

const storefrontCss = Object.entries({ ...cssModules, ...globalCss }).filter(
  ([path]) => !/\bAdmin[A-Z]/.test(path),
)

/** Every width literal allowed inside an `@media` condition in storefront CSS. */
const CANONICAL = [480, 640, 768, 1023, 1024]
/** Paired sides of a hard swap (aside 720/721, xl 1023/1024). */
const PAIRED = [720, 721]
/** Documented component-specific one-offs (see tokens.css). */
const COMPONENT_SPECIFIC = [560, 860, 1280]
const ALLOWED = new Set<number>([...CANONICAL, ...PAIRED, ...COMPONENT_SPECIFIC])

const MEDIA_PRELUDE = /@media([^{]+)\{/g
const WIDTH_IN_CONDITION = /(?:min|max)-width:\s*(\d+(?:\.\d+)?)px/g

describe('UX-16 — canonical responsive breakpoints', () => {
  it('finds the storefront CSS to check', () => {
    expect(storefrontCss.length).toBeGreaterThan(20)
  })

  it('every @media width literal is a known canonical or documented breakpoint', () => {
    const offenders: string[] = []

    for (const [path, css] of storefrontCss) {
      for (const prelude of css.matchAll(MEDIA_PRELUDE)) {
        for (const match of prelude[1].matchAll(WIDTH_IN_CONDITION)) {
          const value = Number(match[1])
          if (!ALLOWED.has(value)) {
            offenders.push(`${path}: @media (... ${match[0]} ...)`)
          }
        }
      }
    }

    expect(offenders, `unexpected @media breakpoint(s):\n${offenders.join('\n')}`).toEqual([])
  })

  it('the xl swap is always written as the 1023/1024 pair, never a bare 1024 max-width', () => {
    const badXl: string[] = []
    for (const [path, css] of storefrontCss) {
      for (const prelude of css.matchAll(MEDIA_PRELUDE)) {
        if (/max-width:\s*1024px/.test(prelude[1])) {
          badXl.push(path)
        }
      }
    }
    expect(badXl, `use max-width: 1023px for the "below desktop" side:\n${badXl.join('\n')}`).toEqual(
      [],
    )
  })

  it('tokens.css still documents the canonical scale', () => {
    const tokens = globalCss['/src/styles/tokens.css'] ?? ''
    expect(tokens).toContain('CANONICAL RESPONSIVE BREAKPOINTS')
    for (const bp of ['480px', '640px', '720px', '768px', '1024px']) {
      expect(tokens).toContain(bp)
    }
  })

  it('the storefront has no JavaScript responsive logic (CSS-only breakpoints)', () => {
    const jsBreakpointUse =
      /\bmatchMedia\b|\.innerWidth\b|\.outerWidth\b|addEventListener\(\s*['"]resize['"]|new ResizeObserver/
    // Both flagged files use the regex's trigger APIs for something that
    // isn't a width breakpoint at all, so neither belongs in the "drifted
    // back into JS" case this guard exists for:
    //   - CategoryStoryBar / Hero: `matchMedia('(prefers-reduced-motion: reduce)')`
    //     is an accessibility preference query, not a layout breakpoint.
    //   - HorizontalScroller: ResizeObserver only to show/hide overflow
    //     arrow buttons — not a viewport breakpoint.
    //   - mediaAsset: matchMedia('(prefers-reduced-motion)') / saveData
    //     for video autoplay, not layout.
    const EXEMPT = new Set([
      '/src/components/home/CategoryStoryBar.tsx',
      '/src/components/home/Hero.tsx',
      '/src/components/layout/AnnouncementBar.tsx',
      '/src/components/ui/HorizontalScroller.tsx',
      '/src/features/media/mediaAsset.ts',
    ])
    const offenders = Object.entries(tsFiles)
      .filter(([path, src]) => !EXEMPT.has(path) && jsBreakpointUse.test(src))
      .map(([path]) => path)

    expect(
      offenders,
      `responsive behavior must stay in CSS; if JS truly needs a breakpoint, centralize it and document the link to tokens.css:\n${offenders.join('\n')}`,
    ).toEqual([])
  })
})
