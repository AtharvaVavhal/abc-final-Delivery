import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Prisma, PrismaClient } from '@prisma/client'
import { withPlatformRlsBypass } from '../src/common/tenant/tenant-rls'
import type { PrismaService } from '../src/common/database/prisma.service'

/**
 * Idempotent Identica catalog from mahakaladvertising.com sitemap listings.
 * Maps each listing onto the seeded Identica category / subcategory tree.
 * Prices and images come from the listing; quote-only rows stay 0.00.
 *
 *   npx ts-node prisma/seed-identica-products.ts
 */

loadLocalEnv()

type SpecMap = Record<string, string>

interface CatalogProduct {
  categorySlug: string
  groupSlug: string
  name: string
  slug: string
  price: string
  minQuantity?: number
  imageUrl: string
  imageUrls?: string[]
  specifications: SpecMap
}

interface CatalogFile {
  source: string
  count: number
  products: CatalogProduct[]
}

function loadCatalog(): CatalogProduct[] {
  const filePath = resolve(__dirname, 'identica-products.json')
  const payload = JSON.parse(readFileSync(filePath, 'utf8')) as CatalogFile
  if (!Array.isArray(payload.products) || payload.products.length === 0) {
    throw new Error(`No products in ${filePath}`)
  }
  return payload.products
}

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

function catalogImages(item: CatalogProduct): string[] {
  const urls = (item.imageUrls ?? []).filter((url) => url.length > 0)
  if (urls.length > 0) return [...new Set(urls)]
  return item.imageUrl ? [item.imageUrl] : []
}

function specsEqual(left: Record<string, unknown>, right: SpecMap): boolean {
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

  const products = loadCatalog()
  const slugs = products.map((item) => item.slug)
  if (new Set(slugs).size !== slugs.length) {
    throw new Error('Identica catalog has duplicate product slugs')
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

        const neededSlugs = [...new Set(products.map((item) => item.categorySlug))]
        const categories = await tx.category.findMany({
          where: { tenantId: tenant.id, slug: { in: neededSlugs }, isActive: true },
        })
        const categoryBySlug = new Map(categories.map((row) => [row.slug, row]))
        const missing = neededSlugs.filter((slug) => !categoryBySlug.has(slug))
        if (missing.length > 0) {
          throw new Error(
            `Missing categories (run seed-identica-categories.ts first): ${missing.join(', ')}`,
          )
        }

        const existingRows = await tx.product.findMany({
          where: { tenantId: tenant.id, slug: { in: slugs } },
          include: { images: { orderBy: { sortOrder: 'asc' } } },
        })
        const existingBySlug = new Map(existingRows.map((row) => [row.slug, row]))

        const created: string[] = []
        const updated: string[] = []
        let unchanged = 0

        const toCreate = products.filter((item) => !existingBySlug.has(item.slug))
        if (toCreate.length > 0) {
          await tx.product.createMany({
            data: toCreate.map((item) => {
              const category = categoryBySlug.get(item.categorySlug)
              if (!category) throw new Error(`Category not found: ${item.categorySlug}`)
              return {
                categoryId: category.id,
                name: item.name,
                slug: item.slug,
                basePrice: item.price,
                minQuantity: item.minQuantity && item.minQuantity > 0 ? item.minQuantity : 1,
                specifications: item.specifications as Prisma.InputJsonValue,
                isActive: true,
                tenantId: tenant.id,
                storeId: store.id,
              }
            }),
          })
          created.push(...toCreate.map((item) => item.slug))
        }

        const createdRows =
          toCreate.length === 0
            ? []
            : await tx.product.findMany({
                where: { tenantId: tenant.id, slug: { in: toCreate.map((item) => item.slug) } },
              })
        const createdBySlug = new Map(createdRows.map((row) => [row.slug, row]))

        const imageCreates: Prisma.ProductImageCreateManyInput[] = []
        const imageDeleteIds: string[] = []

        for (const item of toCreate) {
          const row = createdBySlug.get(item.slug)
          const images = catalogImages(item)
          if (!row || images.length === 0) continue
          images.forEach((url, index) => {
            imageCreates.push({
              productId: row.id,
              cloudinaryPublicId: url,
              resourceType: 'image',
              deliveryType: 'upload',
              sortOrder: index,
              isPrimary: index === 0,
              tenantId: tenant.id,
              storeId: store.id,
            })
          })
        }

        for (const item of products) {
          const existing = existingBySlug.get(item.slug)
          if (!existing) continue
          const category = categoryBySlug.get(item.categorySlug)
          if (!category) throw new Error(`Category not found: ${item.categorySlug}`)

          const minQuantity =
            item.minQuantity && item.minQuantity > 0 ? item.minQuantity : 1
          const sameCategory = existing.categoryId === category.id
          const sameName = existing.name === item.name
          const samePrice = moneyEqual(existing.basePrice, item.price)
          const sameSpecs = specsEqual(
            asSpecRecord(existing.specifications),
            item.specifications,
          )
          const sameActive = existing.isActive
          const sameMinQty = existing.minQuantity === minQuantity
          const productUnchanged =
            sameCategory &&
            sameName &&
            samePrice &&
            sameSpecs &&
            sameActive &&
            sameMinQty

          if (!productUnchanged) {
            await tx.product.update({
              where: { id: existing.id },
              data: {
                categoryId: category.id,
                name: item.name,
                basePrice: item.price,
                minQuantity,
                specifications: item.specifications as Prisma.InputJsonValue,
                isActive: true,
                storeId: existing.storeId ?? store.id,
              },
            })
            updated.push(item.slug)
          }

          const wanted = catalogImages(item)
          if (wanted.length === 0) {
            if (productUnchanged) unchanged += 1
            continue
          }

          const have = existing.images.map((image) => image.cloudinaryPublicId)
          const imageUnchanged =
            have.length === wanted.length &&
            have.every((url, index) => url === wanted[index]) &&
            existing.images[0]?.isPrimary === true
          if (imageUnchanged) {
            if (productUnchanged) unchanged += 1
            continue
          }

          if (existing.images.length > 0) {
            imageDeleteIds.push(...existing.images.map((image) => image.id))
          }
          wanted.forEach((url, index) => {
            imageCreates.push({
              productId: existing.id,
              cloudinaryPublicId: url,
              resourceType: 'image',
              deliveryType: 'upload',
              sortOrder: index,
              isPrimary: index === 0,
              tenantId: tenant.id,
              storeId: existing.storeId ?? store.id,
            })
          })
          if (!updated.includes(item.slug)) updated.push(item.slug)
        }

        if (imageDeleteIds.length > 0) {
          await tx.productImage.deleteMany({ where: { id: { in: imageDeleteIds } } })
        }
        if (imageCreates.length > 0) {
          await tx.productImage.createMany({ data: imageCreates })
        }

        return { created, updated, unchanged, categoryCount: neededSlugs.length }
      },
      { maxWait: 20_000, timeout: 180_000 },
    )

    console.log(`categories used ${result.categoryCount}`)
    console.log(`created ${result.created.length}`)
    for (const slug of result.created) console.log(`  + ${slug}`)
    console.log(`updated ${result.updated.length}`)
    for (const slug of result.updated) console.log(`  ~ ${slug}`)
    console.log(`unchanged ${result.unchanged}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
