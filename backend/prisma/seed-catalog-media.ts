import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { withPlatformRlsBypass } from '../src/common/tenant/tenant-rls'
import type { PrismaService } from '../src/common/database/prisma.service'

/**
 * Attaches generated storefront files (frontend/public/catalog) to SKUs
 * and homepage settings. Public ids use the `local/` prefix so
 * UploadsService.resolveUrl serves them from the Vite/Vercel public folder.
 *
 *   npx ts-node prisma/seed-catalog-media.ts
 */

loadLocalEnv()

const SKU_FILES: Record<string, string> = {
  PAC01: 'PAC01.jpg',
  PAC04: 'PAC04.jpg',
  PAC02: 'PAC02.jpg',
  PAC03: 'PAC03.jpg',
  PAC05: 'PAC05.jpg',
  PAC06: 'PAC06.jpg',
  PAC08: 'PAC08.jpg',
  PAC09: 'PAC09.jpg',
  PAC10: 'PAC10.jpg',
  PAC11: 'PAC11.jpg',
  'ACP-01': 'ACP-01.jpg',
  'ACP-02': 'ACP-02.jpg',
  'ACP-03': 'ACP-03.jpg',
  'ACP-04': 'ACP-04.jpg',
  'ACP-05': 'ACP-05.jpg',
  'ACP-06': 'ACP-06.jpg',
  'ACP-07': 'ACP-07.jpg',
  'ACP-08': 'ACP-08.jpg',
  'ACP-09': 'ACP-09.jpg',
  'APS-01': 'APS-01.jpg',
  PAPS01: 'PAPS01.jpg',
  PAPS03: 'PAPS03.jpg',
  'PACLOCK-01': 'PACLOCK-01.jpg',
  'PACLOCK-02': 'PACLOCK-02.jpg',
  'PACLOCK-03': 'PACLOCK-03.jpg',
  'PACLOCK-04': 'PACLOCK-04.jpg',
  'PACLOCK-05': 'PACLOCK-05.jpg',
  'DPF-01': 'DPF-01.jpg',
  'DPF-02': 'DPF-02.jpg',
  'DPF-03': 'DPF-03.jpg',
  CDG02: 'CDG02.jpg',
  CDG04: 'CDG04.jpg',
  'DPH-01': 'DASHBOARD-PHOTO.jpg',
  'CHP-01': 'CAR-HANGING-PHOTO.jpg',
}

const HERO_SLIDES = [
  {
    imageUrl: '/catalog/hero-3.jpg',
    headline: 'Acrylic caricatures from your photo',
    subtext: 'Made to order. Typically 3–5 working days after we receive your files.',
    ctaText: 'Shop acrylic gifts',
    ctaLink: '/products?category=acrylic-gifts',
  },
  {
    imageUrl: '/catalog/hero-4.jpg',
    headline: 'Corporate gifting, ready for your brand',
    subtext: 'Polos, diaries, bottles, and pens — print-ready for teams and events.',
    ctaText: 'Shop corporate',
    ctaLink: '/products?category=corporate-and-branding',
  },
  {
    imageUrl: '/catalog/hero-5.jpg',
    headline: 'Wedding and festive keepsakes',
    subtext: 'Personalised acrylic plaques for the people you celebrate.',
    ctaText: 'Shop gifts',
    ctaLink: '/products?category=personalized-gifts',
  },
]

const BANNERS = [
  {
    imageUrl: '/catalog/banner-1.jpg',
    title: 'Acrylic gifts',
    text: 'Cutouts, caricatures, clocks, and standees.',
    link: '/products',
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

function skuFromSpec(spec: unknown): string | null {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return null
  const sku = (spec as Record<string, unknown>).SKU
  return typeof sku === 'string' && sku.trim() ? sku.trim() : null
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set')
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

        const products = await tx.product.findMany({
          where: { tenantId: tenant.id, isActive: true },
          select: {
            id: true,
            name: true,
            specifications: true,
            storeId: true,
          },
        })

        const attached: string[] = []
        const skipped: string[] = []

        if (process.env.HERO_ONLY !== '1') {
        for (const product of products) {
          const sku = skuFromSpec(product.specifications)
          const file = sku ? SKU_FILES[sku] : undefined
          if (!file) {
            skipped.push(product.name)
            continue
          }

          const publicId = `local/catalog/${file}`
          await tx.productImage.deleteMany({
            where: { productId: product.id },
          })
          await tx.productImage.create({
            data: {
              productId: product.id,
              cloudinaryPublicId: publicId,
              resourceType: 'image',
              deliveryType: 'upload',
              sortOrder: 0,
              isPrimary: true,
              tenantId: tenant.id,
              storeId: product.storeId ?? store.id,
            },
          })
          attached.push(`${sku} → ${file}`)
        }
        }

        const homepage: Array<{ key: string; value: string }> = [
          { key: 'hero_slides', value: JSON.stringify(HERO_SLIDES) },
          { key: 'banners', value: JSON.stringify(BANNERS) },
          {
            key: 'featured_media',
            value: JSON.stringify(['/catalog/about.jpg', '/catalog/hero-1.jpg']),
          },
        ]

        for (const row of homepage) {
          await tx.storeSetting.upsert({
            where: { storeId_key: { storeId: store.id, key: row.key } },
            create: {
              tenantId: tenant.id,
              storeId: store.id,
              key: row.key,
              value: row.value,
            },
            update: { value: row.value },
          })
        }

        return { attached, skipped, homepageKeys: homepage.map((row) => row.key) }
      },
      { maxWait: 15_000, timeout: 120_000 },
    )

    console.log(`attached ${result.attached.length}`)
    for (const line of result.attached) console.log(`  + ${line}`)
    console.log(`no matching file ${result.skipped.length}`)
    for (const name of result.skipped) console.log(`  = ${name}`)
    console.log(`homepage ${result.homepageKeys.join(', ')}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
