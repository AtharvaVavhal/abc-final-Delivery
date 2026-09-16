import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'
import {
  heroLcpPreload,
  heroMediaHtml,
  optimizedCloudinaryHeroUrl,
} from './src/features/media/heroLcpImage.ts'

const VISIBLE_CATEGORY_LIMIT = 3
const LOGO_WIDTH = 188
const GROUP_SLUGS = [
  'corporate-signage',
  'led-signages',
  'led-letters',
  'led-signage-board',
  'office-and-building-signage-board',
  'retail-signages',
  'led-sign-board',
  'signage-name-plates',
  'pylons-lolipop',
  'acrylic-box-solid-letters',
  'solid-letters',
  'led-signages-logo',
  'safety-signs',
  'graphics-service',
  'sky-signages',
  'digital-standee',
  'glow-signs',
  'metal-labels',
  'cladding-work',
  'uv-printing-services',
  'flex-branding-work',
  'sign-board-poles',
  'acrylic-gifts',
  'personalized-gifts',
  'home-and-decor',
  'corporate-and-branding',
  'car-and-auto',
] as const

type ShellCategory = { id: string; name: string; slug: string }
type HeroSlide = {
  imageUrl: string
  headline: string
  subtext: string
  ctaText: string
  ctaLink: string
}

interface StorefrontShellSnapshot {
  settings: {
    storeName: string | null
    storeLogo: string | null
    announcement_text: string
    homepage: { hero_slides?: HeroSlide[] }
  }
  categories: ShellCategory[]
  lcp?: {
    sourceUrl: string
    href: string
    type: string
    sizes: string
    srcsetAvif: string
    srcsetWebp: string
    srcsetJpg: string
    fallback: string
  } | null
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function loadSnapshot(rootDir: string): StorefrontShellSnapshot {
  const raw = readFileSync(
    path.join(rootDir, 'src/generated/storefront-shell.json'),
    'utf8',
  )
  return JSON.parse(raw) as StorefrontShellSnapshot
}

function firstHero(shell: StorefrontShellSnapshot) {
  return shell.settings.homepage.hero_slides?.[0]
}

function visibleNav(categories: ShellCategory[]): ShellCategory[] {
  const rank = new Map(GROUP_SLUGS.map((slug, index) => [slug, index]))
  return [...categories]
    .sort((a, b) => {
      const aRank = rank.get(a.slug as (typeof GROUP_SLUGS)[number])
      const bRank = rank.get(b.slug as (typeof GROUP_SLUGS)[number])
      if (aRank !== undefined && bRank !== undefined) return aRank - bRank
      if (aRank !== undefined) return -1
      if (bRank !== undefined) return 1
      return a.name.localeCompare(b.name)
    })
    .slice(0, VISIBLE_CATEGORY_LIMIT)
}

export function buildStorefrontShellHtml(shell: StorefrontShellSnapshot): string {
  const storeName = shell.settings.storeName?.trim() || 'AB Creations'
  const logo = shell.settings.storeLogo?.trim() || '/catalog/logo.png'
  const logoSrc = optimizedCloudinaryHeroUrl(logo, LOGO_WIDTH)
  const announcement = shell.settings.announcement_text.trim()
  const hero = firstHero(shell)
  const nav = visibleNav(shell.categories)

  const navItems = [
    `<li><a href="/">Home</a></li>`,
    ...nav.map(
      (category) =>
        `<li><a href="/products?categoryId=${encodeURIComponent(category.id)}">${escapeHtml(category.name)}</a></li>`,
    ),
  ].join('')

  const heroImage = hero?.imageUrl
    ? heroMediaHtml(hero.imageUrl, escapeHtml(hero.headline), true)
    : ''

  const heroCopy = hero
    ? `<div class="pf-hero-copy">
        <h1>${escapeHtml(hero.headline)}</h1>
        ${hero.subtext ? `<p>${escapeHtml(hero.subtext)}</p>` : ''}
        ${hero.ctaText && hero.ctaLink ? `<a class="pf-hero-cta" href="${escapeHtml(hero.ctaLink)}">${escapeHtml(hero.ctaText)}</a>` : ''}
      </div>`
    : `<div class="pf-hero-copy"><h1>${escapeHtml(storeName)}</h1></div>`

  return `<div id="storefront-shell">
  ${announcement ? `<div class="pf-announce">${escapeHtml(announcement)}</div>` : ''}
  <header class="pf-header">
    <div class="pf-header-inner">
      <a class="pf-brand" href="/" aria-label="${escapeHtml(storeName)} home">
        <img src="${escapeHtml(logoSrc)}" alt="" width="188" height="44" decoding="async" />
      </a>
      <ul class="pf-nav">${navItems}</ul>
    </div>
  </header>
  <section class="pf-hero" aria-label="Promotional hero">
    <div class="pf-hero-stage">${heroImage}</div>
    ${heroCopy}
  </section>
</div>`
}

/** Homepage-only gate. Inlined so first paint does not wait on a network script. */
export const STOREFRONT_SHELL_BOOT_SCRIPT = `(function () {
  var path = location.pathname
  if (path === '/' || path === '') {
    document.documentElement.setAttribute('data-storefront-home', '')
  }
})()`

/** Applies the Vite CSS bundle after it loads without blocking first paint. */
export const STOREFRONT_SHELL_CSS_SCRIPT = `(function () {
  var el = document.getElementById('pf-app-css')
  if (!el) return
  if (el.sheet) el.media = 'all'
  else el.onload = function () { el.media = 'all' }
})()`

export function cspSha256(source: string): string {
  return `sha256-${createHash('sha256').update(source).digest('base64')}`
}

function withInlineScriptCsp(html: string, sources: string[]): string {
  const hashes = sources.map((source) => `'${cspSha256(source)}'`).join(' ')
  return html.replace("script-src 'self'", `script-src 'self' ${hashes}`)
}

function deferRenderBlockingStylesheet(html: string): string {
  return html.replace(
    /<link rel="stylesheet" crossorigin href="(\/assets\/[^"]+\.css)">/,
    `<link rel="stylesheet" crossorigin href="$1" media="print" id="pf-app-css">\n    <noscript><link rel="stylesheet" crossorigin href="$1"></noscript>\n    <script>${STOREFRONT_SHELL_CSS_SCRIPT}</script>`,
  )
}

export function storefrontShellHtmlPlugin(rootDir: string): Plugin {
  const cssPath = path.join(rootDir, 'src/styles/storefront-shell.css')
  const shell = loadSnapshot(rootDir)
  const hero = firstHero(shell)
  const preload = hero?.imageUrl ? heroLcpPreload(hero.imageUrl) : null

  return {
    name: 'storefront-shell-html',
    transformIndexHtml: {
      // After Vite injects the hashed CSS link so we can make it non-blocking.
      order: 'post',
      handler(html) {
        const css = readFileSync(cssPath, 'utf8')
        const shellHtml = buildStorefrontShellHtml(shell)
        const preloadHero = preload
          ? `<link rel="preload" as="image" type="${escapeHtml(preload.type)}" href="${escapeHtml(preload.href)}" imagesrcset="${escapeHtml(preload.imagesrcset)}" imagesizes="${escapeHtml(preload.imagesizes)}" fetchpriority="high" />`
          : ''
        const json = `<script type="application/json" id="storefront-shell-data">${JSON.stringify(shell)}</script>`
        const boot = `<script>${STOREFRONT_SHELL_BOOT_SCRIPT}</script>`

        let next = html
          .replace(
            '<title>',
            `${preloadHero}\n    <style>${css}</style>\n    ${boot}\n    ${json}\n    <title>`,
          )
          .replace(
            '<div id="root"></div>',
            `<div id="root">\n      ${shellHtml}\n    </div>`,
          )

        const deferred = deferRenderBlockingStylesheet(next)
        const scripts = [STOREFRONT_SHELL_BOOT_SCRIPT]
        if (deferred !== next) {
          scripts.push(STOREFRONT_SHELL_CSS_SCRIPT)
          next = deferred
        }
        return withInlineScriptCsp(next, scripts)
      },
    },
  }
}
