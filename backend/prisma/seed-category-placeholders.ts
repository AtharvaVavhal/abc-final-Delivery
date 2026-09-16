import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Prisma, PrismaClient } from '@prisma/client'
import { withPlatformRlsBypass } from '../src/common/tenant/tenant-rls'
import type { PrismaService } from '../src/common/database/prisma.service'

/**
 * Creates one catalog product per empty category using mockups in
 * frontend/public/catalog (copied from product-images/).
 *
 *   npx ts-node prisma/seed-category-placeholders.ts
 */

loadLocalEnv()

interface Placeholder {
  categorySlug: string
  name: string
  slug: string
  price: string
  sku: string
  file: string
  specs: Record<string, string>
}

const PLACEHOLDERS: Placeholder[] = [
  {
    categorySlug: 'acrylic-photos',
    name: 'Personalised Acrylic Photo',
    slug: 'personalised-acrylic-photo',
    price: '599.00',
    sku: 'AAP-01',
    file: 'ACRYLIC-PHOTO.jpg',
    specs: { SKU: 'AAP-01', 'Product type': 'Rectangular acrylic photo plaque' },
  },
  {
    categorySlug: 'acrylic-wall-art',
    name: 'Acrylic Wall Art',
    slug: 'acrylic-wall-art-piece',
    price: '1299.00',
    sku: 'AWA-01',
    file: 'ACRYLIC-WALL-ART.jpg',
    specs: { SKU: 'AWA-01', 'Product type': 'Acrylic wall-mounted artwork' },
  },
  {
    categorySlug: 'acrylic-photo-frames',
    name: 'Acrylic Photo Frame',
    slug: 'acrylic-photo-frame',
    price: '699.00',
    sku: 'APF-01',
    file: 'ACRYLIC-PHOTO-FRAME.jpg',
    specs: { SKU: 'APF-01', 'Product type': 'Acrylic photo frame' },
  },
  {
    categorySlug: 't-shirts',
    name: 'Personalised T-Shirt',
    slug: 'personalised-t-shirt',
    price: '499.00',
    sku: 'PTS-01',
    file: 'TSHIRT.jpg',
    specs: { SKU: 'PTS-01', 'Product type': 'Custom printed t-shirt' },
  },
  {
    categorySlug: 'mugs',
    name: 'Personalised Mug',
    slug: 'personalised-mug',
    price: '249.00',
    sku: 'PMG-01',
    file: 'MUG.jpg',
    specs: { SKU: 'PMG-01', 'Product type': 'Ceramic photo mug' },
  },
  {
    categorySlug: 'bottles',
    name: 'Personalised Bottle',
    slug: 'personalised-bottle',
    price: '399.00',
    sku: 'PBT-01',
    file: 'BOTTLE.jpg',
    specs: { SKU: 'PBT-01', 'Product type': 'Reusable personalised bottle' },
  },
  {
    categorySlug: 'pens',
    name: 'Personalised Pen',
    slug: 'personalised-pen',
    price: '149.00',
    sku: 'PPN-01',
    file: 'PEN.jpg',
    specs: { SKU: 'PPN-01', 'Product type': 'Custom engraved pen' },
  },
  {
    categorySlug: 'fridge-magnets',
    name: 'Personalised Fridge Magnet',
    slug: 'personalised-fridge-magnet',
    price: '199.00',
    sku: 'PFM-01',
    file: 'FRIDGE-MAGNET.jpg',
    specs: { SKU: 'PFM-01', 'Product type': 'Photo fridge magnet' },
  },
  {
    categorySlug: 'key-car-photos',
    name: 'Personalised Keychain Photo',
    slug: 'personalised-keychain-photo',
    price: '249.00',
    sku: 'PKC-01',
    file: 'KEYCHAIN-CAR-PHOTO.jpg',
    specs: { SKU: 'PKC-01', 'Product type': 'Photo keychain' },
  },
  {
    categorySlug: 'illusion-lamps',
    name: 'Personalised Illusion Lamp',
    slug: 'personalised-illusion-lamp',
    price: '799.00',
    sku: 'PIL-01',
    file: 'ILLUSION-LAMP.jpg',
    specs: { SKU: 'PIL-01', 'Product type': 'Acrylic LED illusion lamp' },
  },
  {
    categorySlug: 'name-plates',
    name: 'Personalised Name Plate',
    slug: 'personalised-name-plate',
    price: '899.00',
    sku: 'NPL-01',
    file: 'NAME-PLATE.jpg',
    specs: { SKU: 'NPL-01', 'Product type': 'Residential name plate' },
  },
  {
    categorySlug: 'wall-art',
    name: 'Canvas Wall Art',
    slug: 'canvas-wall-art',
    price: '1499.00',
    sku: 'CWA-01',
    file: 'WALL-ART.jpg',
    specs: { SKU: 'CWA-01', 'Product type': 'Framed canvas wall art' },
  },
  {
    categorySlug: 'clocks',
    name: 'Home Decorative Clock',
    slug: 'home-decorative-clock',
    price: '799.00',
    sku: 'HDC-01',
    file: 'HOME-CLOCK.jpg',
    specs: { SKU: 'HDC-01', 'Product type': 'Decorative wall clock' },
  },
  {
    categorySlug: 'corporate-t-shirts',
    name: 'Corporate Polo Shirt',
    slug: 'corporate-polo-shirt',
    price: '599.00',
    sku: 'CPS-01',
    file: 'CORPORATE-POLO.jpg',
    specs: { SKU: 'CPS-01', 'Product type': 'Corporate polo for branding' },
  },
  {
    categorySlug: 'badges',
    name: 'Corporate Badge',
    slug: 'corporate-badge',
    price: '199.00',
    sku: 'CBG-01',
    file: 'CORPORATE-BADGE.jpg',
    specs: { SKU: 'CBG-01', 'Product type': 'Employee ID badge' },
  },
  {
    categorySlug: 'corporate-pens',
    name: 'Corporate Pen',
    slug: 'corporate-pen',
    price: '199.00',
    sku: 'CPN-01',
    file: 'CORPORATE-PEN.jpg',
    specs: { SKU: 'CPN-01', 'Product type': 'Metal corporate pen' },
  },
  {
    categorySlug: 'corporate-bottles',
    name: 'Corporate Bottle',
    slug: 'corporate-bottle',
    price: '499.00',
    sku: 'CBT-01',
    file: 'CORPORATE-BOTTLE.jpg',
    specs: { SKU: 'CBT-01', 'Product type': 'Corporate reusable bottle' },
  },
  {
    categorySlug: 'corporate-diaries',
    name: 'Corporate Diary',
    slug: 'corporate-diary',
    price: '399.00',
    sku: 'CDY-01',
    file: 'CORPORATE-DIARY.jpg',
    specs: { SKU: 'CDY-01', 'Product type': 'Hardcover corporate notebook' },
  },
  {
    categorySlug: 'trophies',
    name: 'Corporate Trophy',
    slug: 'corporate-trophy',
    price: '1499.00',
    sku: 'TRP-01',
    file: 'TROPHY.jpg',
    specs: { SKU: 'TRP-01', 'Product type': 'Business award trophy' },
  },
  {
    categorySlug: 'banner-printing',
    name: 'Banner Print',
    slug: 'banner-print',
    price: '999.00',
    sku: 'BNP-01',
    file: 'BANNER-PRINT.jpg',
    specs: { SKU: 'BNP-01', 'Product type': 'Large-format banner print' },
  },
  {
    categorySlug: 'vinyl-printing',
    name: 'Vinyl Print',
    slug: 'vinyl-print',
    price: '799.00',
    sku: 'VNL-01',
    file: 'VINYL-PRINT.jpg',
    specs: { SKU: 'VNL-01', 'Product type': 'Adhesive vinyl print' },
  },
  {
    categorySlug: 'dashboard-photos',
    name: 'Dashboard Photo',
    slug: 'dashboard-photo',
    price: '399.00',
    sku: 'DPH-01',
    file: 'DASHBOARD-PHOTO.jpg',
    specs: { SKU: 'DPH-01', 'Product type': 'Car dashboard photo display' },
  },
  {
    categorySlug: 'car-hanging-photos',
    name: 'Car Hanging Photo',
    slug: 'car-hanging-photo',
    price: '349.00',
    sku: 'CHP-01',
    file: 'CAR-HANGING-PHOTO.jpg',
    specs: { SKU: 'CHP-01', 'Product type': 'Rear-view mirror hanging photo' },
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

        const slugs = PLACEHOLDERS.map((item) => item.categorySlug)
        const categories = await tx.category.findMany({
          where: { tenantId: tenant.id, slug: { in: slugs }, isActive: true },
        })
        const categoryBySlug = new Map(categories.map((row) => [row.slug, row]))
        const missing = slugs.filter((slug) => !categoryBySlug.has(slug))
        if (missing.length > 0) {
          throw new Error(`Missing categories: ${missing.join(', ')}`)
        }

        const created: string[] = []
        const updated: string[] = []

        for (const item of PLACEHOLDERS) {
          const category = categoryBySlug.get(item.categorySlug)
          if (!category) throw new Error(`Category not found: ${item.categorySlug}`)

          let product = await tx.product.findFirst({
            where: { tenantId: tenant.id, slug: item.slug },
          })

          if (!product) {
            product = await tx.product.create({
              data: {
                categoryId: category.id,
                name: item.name,
                slug: item.slug,
                basePrice: item.price,
                minQuantity: 1,
                specifications: item.specs as Prisma.InputJsonValue,
                isActive: true,
                tenantId: tenant.id,
                storeId: store.id,
              },
            })
            created.push(item.slug)
          } else {
            await tx.product.update({
              where: { id: product.id },
              data: {
                categoryId: category.id,
                name: item.name,
                basePrice: item.price,
                specifications: item.specs as Prisma.InputJsonValue,
                isActive: true,
                storeId: product.storeId ?? store.id,
              },
            })
            updated.push(item.slug)
          }

          const publicId = `local/catalog/${item.file}`
          await tx.productImage.deleteMany({ where: { productId: product.id } })
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
        }

        return { created, updated }
      },
      { maxWait: 15_000, timeout: 120_000 },
    )

    console.log(`created ${result.created.length}`)
    for (const slug of result.created) console.log(`  + ${slug}`)
    console.log(`updated ${result.updated.length}`)
    for (const slug of result.updated) console.log(`  ~ ${slug}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
