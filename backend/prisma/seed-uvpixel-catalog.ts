import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Prisma, PrismaClient } from '@prisma/client'
import { withPlatformRlsBypass } from '../src/common/tenant/tenant-rls'
import type { PrismaService } from '../src/common/database/prisma.service'

/**
 * Idempotent seed for the verified UVPixel catalog (32 products).
 * Specifications come from listing-backed product facts only
 * (material, print, listed sizes/styles, display). No invented images
 * or variant prices.
 *
 *   npx ts-node prisma/seed-uvpixel-catalog.ts
 */

loadLocalEnv()

type SpecMap = Record<string, string>

interface CatalogProduct {
  categorySlug: string
  name: string
  slug: string
  price: string
  sku: string
  specifications: SpecMap
}

function specs(sku: string, extra: SpecMap): SpecMap {
  return { SKU: sku, ...extra }
}

const CARICATURE_SPECS: SpecMap = {
  'Product type': 'Premium acrylic caricature',
  Material: 'Premium acrylic',
  Print: 'Personalized UV caricature from customer photos',
  'Size options': 'Regular 6 inch, Big 11 inch',
  'Style options': 'Half, Full',
  Finish: 'HD print on shatter-resistant acrylic',
  Customization: 'Made to order after photo submission',
  Processing: 'Custom print; typically 3–5 working days',
}

const CUTOUT_BASIC_SPECS: SpecMap = {
  'Product type': 'Acrylic cutout photo',
  Material: 'Premium acrylic',
  Print: 'Personalized UV print from a customer photo',
  Design: 'Custom-shaped cutout based on the submitted photo',
  Finish: 'HD print on shatter-resistant acrylic',
  Customization: 'Made to order after photo submission',
  Processing: 'Custom print; typically 3–5 working days',
}

const CUTOUT_EASEL_SPECS: SpecMap = {
  'Product type': 'Premium acrylic cutout photo',
  Material: '5 mm crystal-clear acrylic',
  Print: 'Fade-resistant UV print (chemical treatment before printing)',
  Design: 'Custom-shaped 3D cutout based on the submitted photo',
  Stand: 'Easel stand included',
  'Size options': 'Regular 6 inch, Big 11 inch',
  'Style options': 'Half body, Full body',
  Customization: 'Made to order after photo submission',
  Processing: 'Artwork 1–2 working days; print and ship typically 5–7 working days',
}

const CUTOUT_FAMILY_EASEL_SPECS: SpecMap = {
  'Product type': 'Premium acrylic family cutout photo',
  Material: 'Premium acrylic',
  Print: 'Personalized UV print from a family photo',
  Design: 'Custom-shaped family cutout',
  Stand: 'Easel stand included',
  'Size options': '11 inch, 14 inch',
  'Style options': 'Half body, Full body',
  Customization: 'Made to order after photo submission',
  Processing: 'Custom print; typically 3–5 working days',
}

const STANDEE_4_PHOTO_SPECS: SpecMap = {
  'Product type': 'Acrylic photo standee',
  Material: '5 mm acrylic',
  Photos: '4 photos',
  'Size options': '10 inch, 12 inch',
  Print: 'Personalized UV print from customer photos',
  Customization: 'Made to order after photo submission',
  Processing: 'Custom print; typically 3–5 working days',
}

const STANDEE_QUOTE_SPECS: SpecMap = {
  'Product type': 'Premium acrylic photo standee with quote',
  Material: 'Premium acrylic',
  Print: 'Personalized UV print from customer photos',
  Feature: 'Custom quote on the standee',
  Customization: 'Made to order after photo and quote submission',
  Processing: 'Custom print; typically 3–5 working days',
}

const CLOCK_SPECS: SpecMap = {
  'Product type': 'Premium acrylic clock',
  Material: 'Premium acrylic',
  Print: 'Personalized UV print',
  'Size options': '11×11 inch, 16×16 inch',
  Use: 'Home or office wall clock',
  Customization: 'Made to order after design/photo submission',
  Processing: 'Custom print; typically 3–5 working days',
}

const DIVINE_FRAME_SPECS: SpecMap = {
  'Product type': 'Divine frame',
  Frame: 'Raw pyrite',
  Use: 'Home and spiritual décor',
  Print: 'Printed divine motif',
  Processing: 'Ready to ship; typically 3–5 working days',
}

const DIARY_SPECS: SpecMap = {
  'Product type': 'Customized diary for gifting',
  Print: 'Personalized cover print',
  Customization: 'Made to order after artwork/text submission',
  Use: 'Personal or corporate gifting',
  Processing: 'Custom print; typically 3–5 working days',
}

const PRODUCTS: CatalogProduct[] = [
  {
    categorySlug: 'acrylic-caricatures',
    name: 'Premium Acrylic Caricature – Couples PAC01',
    slug: 'premium-acrylic-caricature-couples-pac01',
    price: '699.00',
    sku: 'PAC01',
    specifications: specs('PAC01', {
      ...CARICATURE_SPECS,
      Theme: 'Couples',
    }),
  },
  {
    categorySlug: 'acrylic-caricatures',
    name: 'Premium Acrylic Caricature – Couples PAC04',
    slug: 'premium-acrylic-caricature-couples-pac04',
    price: '699.00',
    sku: 'PAC04',
    specifications: specs('PAC04', {
      ...CARICATURE_SPECS,
      Theme: 'Couples',
    }),
  },
  {
    categorySlug: 'acrylic-caricatures',
    name: 'Premium Acrylic Caricature – Loved Ones PAC02',
    slug: 'premium-acrylic-caricature-loved-ones-pac02',
    price: '699.00',
    sku: 'PAC02',
    specifications: specs('PAC02', {
      ...CARICATURE_SPECS,
      Theme: 'Loved ones',
    }),
  },
  {
    categorySlug: 'acrylic-caricatures',
    name: 'Premium Acrylic Caricature – Loved Ones PAC03',
    slug: 'premium-acrylic-caricature-loved-ones-pac03',
    price: '699.00',
    sku: 'PAC03',
    specifications: specs('PAC03', {
      ...CARICATURE_SPECS,
      Theme: 'Loved ones',
    }),
  },
  {
    categorySlug: 'acrylic-caricatures',
    name: 'Premium Acrylic Caricature – Loved Ones PAC05',
    slug: 'premium-acrylic-caricature-loved-ones-pac05',
    price: '699.00',
    sku: 'PAC05',
    specifications: specs('PAC05', {
      ...CARICATURE_SPECS,
      Theme: 'Loved ones',
    }),
  },
  {
    categorySlug: 'acrylic-caricatures',
    name: 'Premium Acrylic Caricature – Family PAC06',
    slug: 'premium-acrylic-caricature-family-pac06',
    price: '699.00',
    sku: 'PAC06',
    specifications: specs('PAC06', {
      ...CARICATURE_SPECS,
      Theme: 'Family',
    }),
  },
  {
    categorySlug: 'acrylic-caricatures',
    name: 'Premium Acrylic Caricature – Loved Ones PAC08',
    slug: 'premium-acrylic-caricature-loved-ones-pac08',
    price: '699.00',
    sku: 'PAC08',
    specifications: specs('PAC08', {
      ...CARICATURE_SPECS,
      Theme: 'Loved ones',
    }),
  },
  {
    categorySlug: 'acrylic-caricatures',
    name: 'Premium Acrylic Caricature – Loved Ones PAC09',
    slug: 'premium-acrylic-caricature-loved-ones-pac09',
    price: '699.00',
    sku: 'PAC09',
    specifications: specs('PAC09', {
      ...CARICATURE_SPECS,
      Theme: 'Loved ones',
    }),
  },
  {
    categorySlug: 'acrylic-caricatures',
    name: 'Premium Acrylic Caricature – Couples PAC10',
    slug: 'premium-acrylic-caricature-couples-pac10',
    price: '699.00',
    sku: 'PAC10',
    specifications: specs('PAC10', {
      ...CARICATURE_SPECS,
      Theme: 'Couples',
    }),
  },
  {
    categorySlug: 'acrylic-caricatures',
    name: 'Premium Acrylic Caricature – Couples PAC11',
    slug: 'premium-acrylic-caricature-couples-pac11',
    price: '699.00',
    sku: 'PAC11',
    specifications: specs('PAC11', {
      ...CARICATURE_SPECS,
      Theme: 'Couples',
    }),
  },
  {
    categorySlug: 'acrylic-cutouts',
    name: 'Acrylic Cutout Photo',
    slug: 'acrylic-cutout-photo',
    price: '699.00',
    sku: 'ACP-01',
    specifications: specs('ACP-01', CUTOUT_BASIC_SPECS),
  },
  {
    categorySlug: 'acrylic-cutouts',
    name: 'Acrylic Cutout Photo 02',
    slug: 'acrylic-cutout-photo-02',
    price: '699.00',
    sku: 'ACP-02',
    specifications: specs('ACP-02', CUTOUT_BASIC_SPECS),
  },
  {
    categorySlug: 'acrylic-cutouts',
    name: 'Premium Acrylic Cutout Photo With Easel Stand 01',
    slug: 'premium-acrylic-cutout-photo-with-easel-stand-01',
    price: '799.00',
    sku: 'ACP-03',
    specifications: specs('ACP-03', CUTOUT_EASEL_SPECS),
  },
  {
    categorySlug: 'acrylic-cutouts',
    name: 'Premium Acrylic Cutout Photo With Easel Stand 02',
    slug: 'premium-acrylic-cutout-photo-with-easel-stand-02',
    price: '799.00',
    sku: 'ACP-04',
    specifications: specs('ACP-04', CUTOUT_EASEL_SPECS),
  },
  {
    categorySlug: 'acrylic-cutouts',
    name: 'Premium Acrylic Cutout Photo With Easel Stand 03',
    slug: 'premium-acrylic-cutout-photo-with-easel-stand-03',
    price: '799.00',
    sku: 'ACP-05',
    specifications: specs('ACP-05', CUTOUT_EASEL_SPECS),
  },
  {
    categorySlug: 'acrylic-cutouts',
    name: 'Premium Acrylic Cutout Photo With Easel Stand 04',
    slug: 'premium-acrylic-cutout-photo-with-easel-stand-04',
    price: '799.00',
    sku: 'ACP-06',
    specifications: specs('ACP-06', CUTOUT_EASEL_SPECS),
  },
  {
    categorySlug: 'acrylic-cutouts',
    name: 'Premium Acrylic Cutout Photo With Easel Stand 06',
    slug: 'premium-acrylic-cutout-photo-with-easel-stand-06',
    price: '799.00',
    sku: 'ACP-07',
    specifications: specs('ACP-07', CUTOUT_EASEL_SPECS),
  },
  {
    categorySlug: 'acrylic-cutouts',
    name: 'Premium Acrylic Cutout Photo With Easel Stand 07',
    slug: 'premium-acrylic-cutout-photo-with-easel-stand-07',
    price: '799.00',
    sku: 'ACP-08',
    specifications: specs('ACP-08', CUTOUT_EASEL_SPECS),
  },
  {
    categorySlug: 'acrylic-cutouts',
    name: 'Premium Acrylic Cutout Family Photo With Easel Stand 03',
    slug: 'premium-acrylic-cutout-family-photo-with-easel-stand-03',
    price: '1299.00',
    sku: 'ACP-09',
    specifications: specs('ACP-09', CUTOUT_FAMILY_EASEL_SPECS),
  },
  {
    categorySlug: 'acrylic-standees',
    name: 'Acrylic Photo Standee – 4 Photos – 5mm',
    slug: 'acrylic-photo-standee-4-photos-5mm',
    price: '1599.00',
    sku: 'APS-01',
    specifications: specs('APS-01', STANDEE_4_PHOTO_SPECS),
  },
  {
    categorySlug: 'acrylic-standees',
    name: 'Premium Acrylic Photo Standee With Quote PAPS01',
    slug: 'premium-acrylic-photo-standee-with-quote-paps01',
    price: '1599.00',
    sku: 'PAPS01',
    specifications: specs('PAPS01', STANDEE_QUOTE_SPECS),
  },
  {
    categorySlug: 'acrylic-standees',
    name: 'Premium Acrylic Photo Standee With Quote PAPS03',
    slug: 'premium-acrylic-photo-standee-with-quote-paps03',
    price: '1599.00',
    sku: 'PAPS03',
    specifications: specs('PAPS03', STANDEE_QUOTE_SPECS),
  },
  {
    categorySlug: 'acrylic-clocks',
    name: 'Premium Acrylic Clock 1',
    slug: 'premium-acrylic-clock-1',
    price: '999.00',
    sku: 'PACLOCK-01',
    specifications: specs('PACLOCK-01', CLOCK_SPECS),
  },
  {
    categorySlug: 'acrylic-clocks',
    name: 'Premium Acrylic Clock 2',
    slug: 'premium-acrylic-clock-2',
    price: '999.00',
    sku: 'PACLOCK-02',
    specifications: specs('PACLOCK-02', CLOCK_SPECS),
  },
  {
    categorySlug: 'acrylic-clocks',
    name: 'Premium Acrylic Clock 3',
    slug: 'premium-acrylic-clock-3',
    price: '999.00',
    sku: 'PACLOCK-03',
    specifications: specs('PACLOCK-03', CLOCK_SPECS),
  },
  {
    categorySlug: 'acrylic-clocks',
    name: 'Premium Acrylic Clock 4',
    slug: 'premium-acrylic-clock-4',
    price: '999.00',
    sku: 'PACLOCK-04',
    specifications: specs('PACLOCK-04', CLOCK_SPECS),
  },
  {
    categorySlug: 'acrylic-clocks',
    name: 'Premium Acrylic Clock 5',
    slug: 'premium-acrylic-clock-5',
    price: '999.00',
    sku: 'PACLOCK-05',
    specifications: specs('PACLOCK-05', CLOCK_SPECS),
  },
  {
    categorySlug: 'divine-frames',
    name: 'Shree Yantra on Raw Pyrite Frame',
    slug: 'shree-yantra-on-raw-pyrite-frame',
    price: '1199.00',
    sku: 'DPF-01',
    specifications: specs('DPF-01', {
      ...DIVINE_FRAME_SPECS,
      Motif: 'Shree Yantra',
    }),
  },
  {
    categorySlug: 'divine-frames',
    name: 'Shubh Labh on Raw Pyrite Frame',
    slug: 'shubh-labh-on-raw-pyrite-frame',
    price: '1199.00',
    sku: 'DPF-02',
    specifications: specs('DPF-02', {
      ...DIVINE_FRAME_SPECS,
      Motif: 'Shubh Labh',
    }),
  },
  {
    categorySlug: 'divine-frames',
    name: '7 Horses on Raw Pyrite Frame',
    slug: '7-horses-on-raw-pyrite-frame',
    price: '1199.00',
    sku: 'DPF-03',
    specifications: specs('DPF-03', {
      ...DIVINE_FRAME_SPECS,
      Motif: '7 Horses',
    }),
  },
  {
    categorySlug: 'diaries',
    name: 'Customize Diary for Gifting CDG02',
    slug: 'customize-diary-for-gifting-cdg02',
    price: '599.00',
    sku: 'CDG02',
    specifications: specs('CDG02', DIARY_SPECS),
  },
  {
    categorySlug: 'diaries',
    name: 'Customize Diary for Gifting CDG04',
    slug: 'customize-diary-for-gifting-cdg04',
    price: '599.00',
    sku: 'CDG04',
    specifications: specs('CDG04', DIARY_SPECS),
  },
]

function loadLocalEnv(): void {
  const envPath = resolve(__dirname, '../.env')
  let text: string
  try {
    text = readFileSync(envPath, 'utf8')
  } catch {
    return
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

function asSpecRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) }
  }
  return {}
}

function moneyEqual(left: Prisma.Decimal, right: string): boolean {
  return new Prisma.Decimal(left).eq(new Prisma.Decimal(right))
}

function specsEqual(
  left: Record<string, unknown>,
  right: SpecMap,
): boolean {
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  if (leftKeys.length !== rightKeys.length) return false
  if (leftKeys.join('\0') !== rightKeys.join('\0')) return false
  return rightKeys.every((key) => String(left[key]) === right[key])
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set')
  }

  const slugs = PRODUCTS.map((item) => item.slug)
  if (new Set(slugs).size !== slugs.length) {
    throw new Error('Catalog seed has duplicate product slugs')
  }

  const prisma = new PrismaClient()
  try {
    const result = await withPlatformRlsBypass(
      prisma as unknown as PrismaService,
      async (tx) => {
        const tenant = await tx.tenant.findFirst({
          where: { status: 'ACTIVE' },
          orderBy: { createdAt: 'asc' },
        })
        if (!tenant) throw new Error('No ACTIVE tenant found')

        const store =
          (await tx.store.findFirst({
            where: { tenantId: tenant.id, isPrimary: true },
          })) ??
          (await tx.store.findFirst({
            where: { tenantId: tenant.id },
            orderBy: { createdAt: 'asc' },
          }))
        if (!store) throw new Error(`No store found for tenant ${tenant.id}`)

        const neededSlugs = [...new Set(PRODUCTS.map((item) => item.categorySlug))]
        const categories = await tx.category.findMany({
          where: { tenantId: tenant.id, slug: { in: neededSlugs }, isActive: true },
        })
        const categoryBySlug = new Map(categories.map((row) => [row.slug, row]))
        const missing = neededSlugs.filter((slug) => !categoryBySlug.has(slug))
        if (missing.length > 0) {
          throw new Error(
            `Missing categories (run seed-ab-creations-categories.ts first): ${missing.join(', ')}`,
          )
        }

        const created: string[] = []
        const updated: string[] = []
        const skipped: string[] = []

        for (const item of PRODUCTS) {
          const category = categoryBySlug.get(item.categorySlug)
          if (!category) throw new Error(`Category not found: ${item.categorySlug}`)

          const existing = await tx.product.findFirst({
            where: { tenantId: tenant.id, slug: item.slug },
          })

          if (!existing) {
            await tx.product.create({
              data: {
                categoryId: category.id,
                name: item.name,
                slug: item.slug,
                basePrice: item.price,
                minQuantity: 1,
                specifications: item.specifications as Prisma.InputJsonValue,
                isActive: true,
                tenantId: tenant.id,
                storeId: store.id,
              },
            })
            created.push(item.slug)
            continue
          }

          const sameCategory = existing.categoryId === category.id
          const sameName = existing.name === item.name
          const samePrice = moneyEqual(existing.basePrice, item.price)
          const sameSpecs = specsEqual(
            asSpecRecord(existing.specifications),
            item.specifications,
          )
          const sameActive = existing.isActive
          if (
            sameCategory &&
            sameName &&
            samePrice &&
            sameSpecs &&
            sameActive
          ) {
            skipped.push(item.slug)
            continue
          }

          await tx.product.update({
            where: { id: existing.id },
            data: {
              categoryId: category.id,
              name: item.name,
              basePrice: item.price,
              specifications: item.specifications as Prisma.InputJsonValue,
              isActive: true,
              storeId: existing.storeId ?? store.id,
            },
          })
          updated.push(item.slug)
        }

        return { created, updated, skipped, categoryCount: neededSlugs.length }
      },
      { maxWait: 15_000, timeout: 120_000 },
    )

    console.log(`categories used ${result.categoryCount}`)
    console.log(`created ${result.created.length}`)
    for (const slug of result.created) console.log(`  + ${slug}`)
    console.log(`updated ${result.updated.length}`)
    for (const slug of result.updated) console.log(`  ~ ${slug}`)
    console.log(`unchanged ${result.skipped.length}`)
    for (const slug of result.skipped) console.log(`  = ${slug}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
