#!/usr/bin/env node
/**
 * Regenerates src/generated/storefront-shell.json and sitemap-paths.json
 * from the live public API.
 *
 * Source of truth remains Store Admin → Nest → PostgreSQL. The shell file
 * is a build-time snapshot of PUBLIC storefront chrome so index.html can
 * paint without a database round-trip. sitemap-paths.json lists public
 * category slugs and product slugs for robots/sitemap.xml.
 * Runtime TanStack Query still refetches /settings and /categories/tree
 * and replaces the snapshot when Store Admin has changed data. Re-run
 * this script (and redeploy the frontend) to refresh the HTML snapshot
 * and the catalog sitemap.
 *
 * Usage:
 *   STOREFRONT_API_ORIGIN=http://127.0.0.1:4000 npm run snapshot:storefront
 *
 * Never writes tenant IDs, cart, auth, orders, or payment data.
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outFile = join(here, '../src/generated/storefront-shell.json')
const sitemapFile = join(here, '../src/generated/sitemap-paths.json')
const origin = (process.env.STOREFRONT_API_ORIGIN || 'http://127.0.0.1:4000').replace(/\/+$/, '')
const KEYS =
  'storeName,storeLogo,whatsappNumber,announcement_text,storeContactEmail,storeContactPhone,storeAddress,sellerLegalName,sellerLocality,sellerGstin,sellerPaymentProtected,hero_slides,banners,showcase_categories,brand_story,featured_media'

function withParent(nodes, parentId = null) {
  return (nodes ?? []).map((node) => ({
    id: node.id,
    name: node.name,
    slug: node.slug,
    parentCategoryId: parentId,
    children: withParent(node.children ?? [], node.id),
  }))
}

function flattenCategorySlugs(nodes, acc = []) {
  for (const node of nodes ?? []) {
    if (node?.slug) acc.push(node.slug)
    flattenCategorySlugs(node.children, acc)
  }
  return acc
}

async function fetchProductSlugs() {
  const slugs = []
  let page = 1
  let totalPages = 1
  do {
    const envelope = await getJson(`/products?page=${page}&limit=100`)
    const items = Array.isArray(envelope?.data) ? envelope.data : []
    for (const item of items) {
      if (item?.slug) slugs.push(item.slug)
    }
    totalPages = Number(envelope?.meta?.totalPages) || page
    page += 1
  } while (page <= totalPages)
  return slugs
}

function parseList(value) {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

async function getJson(path) {
  const res = await fetch(`${origin}/api/v1${path}`)
  if (!res.ok) {
    throw new Error(`${path} failed: HTTP ${res.status}`)
  }
  return res.json()
}

const settingsEnvelope = await getJson(`/settings?keys=${encodeURIComponent(KEYS)}`)
const raw = settingsEnvelope?.data?.data ?? settingsEnvelope?.data ?? {}
const treeEnvelope = await getJson('/categories/tree')
const categories = treeEnvelope?.data ?? []

const featured = parseList(raw.featured_media)
const featuredUrls = featured
  ?.map((item) => (typeof item === 'string' ? item : item?.imageUrl ?? ''))
  .filter(Boolean)

const HERO_WIDTHS = [480, 768, 1024, 1280]
const HERO_PRELOAD_WIDTH = 768

function buildLcp(sourceUrl) {
  if (!sourceUrl) return null
  const local = String(sourceUrl).trim().match(/^\/catalog\/(hero-\d+)\.jpe?g$/i)
  if (local) {
    const base = local[1]
    const srcset = (ext) =>
      HERO_WIDTHS.map((width) => `/catalog/optimized/${base}-${width}.${ext} ${width}w`).join(', ')
    return {
      sourceUrl,
      href: `/catalog/optimized/${base}-${HERO_PRELOAD_WIDTH}.avif`,
      type: 'image/avif',
      sizes: '100vw',
      srcsetAvif: srcset('avif'),
      srcsetWebp: srcset('webp'),
      srcsetJpg: srcset('jpg'),
      fallback: `/catalog/optimized/${base}-${HERO_PRELOAD_WIDTH}.jpg`,
    }
  }
  const cloud = String(sourceUrl).match(
    /^(https:\/\/res\.cloudinary\.com\/[^/]+\/(?:image|video)\/upload\/)(.+)$/i,
  )
  if (cloud && !cloud[2].startsWith('s--') && !/^(?:f_auto|q_auto|c_limit|w_\d+|c_fill|c_fit)/.test(cloud[2])) {
    const transformed = (width) => `${cloud[1]}f_auto,q_auto,c_limit,w_${width}/${cloud[2]}`
    const srcset = HERO_WIDTHS.map((width) => `${transformed(width)} ${width}w`).join(', ')
    return {
      sourceUrl,
      href: transformed(HERO_PRELOAD_WIDTH),
      type: 'image/avif',
      sizes: '100vw',
      srcsetAvif: srcset,
      srcsetWebp: '',
      srcsetJpg: srcset,
      fallback: transformed(HERO_PRELOAD_WIDTH),
    }
  }
  return {
    sourceUrl,
    href: sourceUrl,
    type: 'image/jpeg',
    sizes: '100vw',
    srcsetAvif: sourceUrl,
    srcsetWebp: '',
    srcsetJpg: sourceUrl,
    fallback: sourceUrl,
  }
}

const snapshot = {
  generatedAt: new Date().toISOString(),
  source: {
    origin,
    settingsPath: '/api/v1/settings',
    categoriesPath: '/api/v1/categories/tree',
  },
  deploymentKey: 'ab-creations-storefront',
  lcp: buildLcp(parseList(raw.hero_slides)?.[0]?.imageUrl),
  settings: {
    storeName: raw.storeName ?? null,
    storeLogo: raw.storeLogo ?? null,
    whatsappNumber: raw.whatsappNumber ?? null,
    announcement_text: raw.announcement_text?.trim() ?? '',
    contact: {
      email: raw.storeContactEmail?.trim() ?? '',
      phone: raw.storeContactPhone?.trim() ?? '',
      address: raw.storeAddress?.trim() ?? '',
    },
    seller: {
      legalName: Object.prototype.hasOwnProperty.call(raw, 'sellerLegalName')
        ? String(raw.sellerLegalName ?? '').trim()
        : 'GOURAV KUMAR ABHAY SINGH',
      locality: Object.prototype.hasOwnProperty.call(raw, 'sellerLocality')
        ? String(raw.sellerLocality ?? '').trim()
        : 'Golden City, Magistrate Lane, Maharajpura, Gwalior, MP, India',
      gstin: Object.prototype.hasOwnProperty.call(raw, 'sellerGstin')
        ? String(raw.sellerGstin ?? '').trim()
        : '23EQZPS2886B1Z7',
      paymentProtected:
        raw.sellerPaymentProtected == null
          ? true
          : String(raw.sellerPaymentProtected).trim().toLowerCase() === 'true',
    },
    homepage: {
      hero_slides: parseList(raw.hero_slides),
      banners: parseList(raw.banners),
      showcase_categories: parseList(raw.showcase_categories),
      brand_story: raw.brand_story?.trim() || undefined,
      featured_media: featuredUrls,
    },
  },
  categories: withParent(categories),
}

writeFileSync(outFile, `${JSON.stringify(snapshot, null, 2)}\n`)
console.log(`Wrote ${outFile} (${categories.length} category groups)`)

const categorySlugs = [...new Set(flattenCategorySlugs(categories))].sort()
const productSlugs = [...new Set(await fetchProductSlugs())].sort()
const shareImage =
  typeof raw.storeLogo === 'string' && /^https?:\/\//i.test(raw.storeLogo.trim())
    ? raw.storeLogo.trim()
    : null
writeFileSync(
  sitemapFile,
  `${JSON.stringify(
    {
      generatedAt: snapshot.generatedAt,
      shareImage,
      categories: categorySlugs,
      products: productSlugs,
    },
    null,
    2,
  )}\n`,
)
console.log(
  `Wrote ${sitemapFile} (${categorySlugs.length} categories, ${productSlugs.length} products)`,
)
