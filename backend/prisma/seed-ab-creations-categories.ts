import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PrismaClient, type Category } from '@prisma/client'
import { withPlatformRlsBypass } from '../src/common/tenant/tenant-rls'
import type { PrismaService } from '../src/common/database/prisma.service'

/**
 * Idempotent AB Creations category tree (one nesting level).
 * Renames/reparents existing rows where an old slug is listed as an alias.
 * Does not invent products or prices.
 *
 *   npx ts-node prisma/seed-ab-creations-categories.ts
 */

loadLocalEnv()

interface ChildSpec {
  name: string
  slug: string
  aliases?: string[]
}

interface GroupSpec {
  name: string
  slug: string
  children: ChildSpec[]
}

const TREE: GroupSpec[] = [
  {
    name: 'Acrylic Gifts',
    slug: 'acrylic-gifts',
    children: [
      { name: 'Acrylic Photos', slug: 'acrylic-photos', aliases: ['premium-acrylic-photo'] },
      { name: 'Acrylic Cutouts', slug: 'acrylic-cutouts', aliases: ['premium-acrylic-cutout-photo'] },
      {
        name: 'Acrylic Caricatures',
        slug: 'acrylic-caricatures',
        aliases: ['premium-acrylic-caricature'],
      },
      { name: 'Acrylic Clocks', slug: 'acrylic-clocks', aliases: ['premium-acrylic-clocks'] },
      { name: 'Acrylic Wall Art', slug: 'acrylic-wall-art', aliases: ['premium-acrylic-wall-art'] },
      {
        name: 'Acrylic Standees',
        slug: 'acrylic-standees',
        aliases: ['premium-acrylic-photo-standee'],
      },
      {
        name: 'Acrylic Photo Frames',
        slug: 'acrylic-photo-frames',
        aliases: ['music-acrylic-photo-frames'],
      },
    ],
  },
  {
    name: 'Personalized Gifts',
    slug: 'personalized-gifts',
    children: [
      { name: 'T-Shirts', slug: 't-shirts', aliases: ['customized-t-shirts'] },
      { name: 'Mugs', slug: 'mugs', aliases: ['mugs-mug-printing'] },
      { name: 'Bottles', slug: 'bottles', aliases: ['customized-water-bottles'] },
      { name: 'Diaries', slug: 'diaries', aliases: ['customized-diary-printing'] },
      { name: 'Pens', slug: 'pens', aliases: ['customized-pen-prints'] },
      { name: 'Fridge Magnets', slug: 'fridge-magnets' },
      { name: 'Key/Car Photos', slug: 'key-car-photos' },
      { name: 'Illusion Lamps', slug: 'illusion-lamps' },
    ],
  },
  {
    name: 'Home & Decor',
    slug: 'home-and-decor',
    children: [
      { name: 'Divine Frames', slug: 'divine-frames' },
      { name: 'Name Plates', slug: 'name-plates' },
      { name: 'Wall Art', slug: 'wall-art' },
      { name: 'Clocks', slug: 'clocks' },
    ],
  },
  {
    name: 'Corporate & Branding',
    slug: 'corporate-and-branding',
    children: [
      {
        name: 'Corporate T-Shirts',
        slug: 'corporate-t-shirts',
        aliases: ['customized-polo-t-shirts'],
      },
      { name: 'Badges', slug: 'badges', aliases: ['magnetic-badges'] },
      { name: 'Pens', slug: 'corporate-pens' },
      { name: 'Bottles', slug: 'corporate-bottles' },
      { name: 'Diaries', slug: 'corporate-diaries' },
      { name: 'Trophies', slug: 'trophies', aliases: ['trophies-awards'] },
      { name: 'Banner Printing', slug: 'banner-printing' },
      { name: 'Vinyl Printing', slug: 'vinyl-printing' },
    ],
  },
  {
    name: 'Car & Auto',
    slug: 'car-and-auto',
    children: [
      { name: 'Dashboard Photos', slug: 'dashboard-photos', aliases: ['dashboard-car-photos'] },
      { name: 'Car Hanging Photos', slug: 'car-hanging-photos' },
    ],
  },
]

const MERGE_INTO: Record<string, string> = {
  'premium-acrylic-cutout-photo-with-stand': 'acrylic-cutouts',
  'premium-acrylic-cutout-photo-with-easel-stand': 'acrylic-cutouts',
  standee: 'acrylic-standees',
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

function wantedSlugs(): Set<string> {
  const slugs = new Set<string>()
  for (const group of TREE) {
    slugs.add(group.slug)
    for (const child of group.children) slugs.add(child.slug)
  }
  return slugs
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

        const existing = await tx.category.findMany({
          where: { tenantId: tenant.id },
        })
        const bySlug = new Map(existing.map((row) => [row.slug, row]))
        const byId = new Map(existing.map((row) => [row.id, row]))

        const created: string[] = []
        const updated: string[] = []

        const remember = (row: Category, previousSlug?: string) => {
          if (previousSlug && previousSlug !== row.slug) bySlug.delete(previousSlug)
          bySlug.set(row.slug, row)
          byId.set(row.id, row)
        }

        const upsert = async (
          spec: { name: string; slug: string; aliases?: string[] },
          parentId: string | null,
        ): Promise<Category> => {
          const canonical = bySlug.get(spec.slug)
          const alias = (spec.aliases ?? [])
            .map((slug) => bySlug.get(slug))
            .find((row) => row && row.id !== canonical?.id)

          if (canonical && alias) {
            await tx.product.updateMany({
              where: { categoryId: alias.id },
              data: { categoryId: canonical.id },
            })
            const deactivated = await tx.category.update({
              where: { id: alias.id },
              data: { isActive: false, parentCategoryId: null },
            })
            bySlug.delete(alias.slug)
            byId.set(deactivated.id, deactivated)
          }

          const found = canonical ?? alias
          if (!found) {
            const row = await tx.category.create({
              data: {
                name: spec.name,
                slug: spec.slug,
                parentCategoryId: parentId,
                tenantId: tenant.id,
                storeId: store.id,
                isActive: true,
              },
            })
            remember(row)
            created.push(spec.slug)
            return row
          }

          const previousSlug = found.slug
          const row = await tx.category.update({
            where: { id: found.id },
            data: {
              name: spec.name,
              slug: spec.slug,
              parentCategoryId: parentId,
              storeId: store.id,
              isActive: true,
            },
          })
          remember(row, previousSlug)
          if (
            found.name !== spec.name ||
            found.slug !== spec.slug ||
            found.parentCategoryId !== parentId ||
            !found.isActive
          ) {
            updated.push(spec.slug)
          }
          return row
        }

        for (const group of TREE) {
          const parent = await upsert({ name: group.name, slug: group.slug }, null)
          for (const child of group.children) {
            await upsert(child, parent.id)
          }
        }

        const keep = wantedSlugs()
        const merged: string[] = []
        for (const [fromSlug, toSlug] of Object.entries(MERGE_INTO)) {
          const source = bySlug.get(fromSlug)
          const target = bySlug.get(toSlug)
          if (!source || !target || source.id === target.id) continue
          await tx.product.updateMany({
            where: { categoryId: source.id },
            data: { categoryId: target.id },
          })
          const deactivated = await tx.category.update({
            where: { id: source.id },
            data: { isActive: false, parentCategoryId: null },
          })
          bySlug.delete(fromSlug)
          byId.set(deactivated.id, deactivated)
          merged.push(`${fromSlug} → ${toSlug}`)
        }

        const deactivated: string[] = []
        const leftover = await tx.category.findMany({
          where: { tenantId: tenant.id, isActive: true },
        })
        for (const row of leftover) {
          if (keep.has(row.slug)) continue
          await tx.category.update({
            where: { id: row.id },
            data: { isActive: false },
          })
          deactivated.push(row.slug)
        }

        return { created, updated, merged, deactivated }
      },
      { maxWait: 15_000, timeout: 90_000 },
    )

    console.log(`created   ${result.created.length}`)
    for (const slug of result.created) console.log(`  + ${slug}`)
    console.log(`updated   ${result.updated.length}`)
    for (const slug of result.updated) console.log(`  ~ ${slug}`)
    console.log(`merged    ${result.merged.length}`)
    for (const line of result.merged) console.log(`  = ${line}`)
    console.log(`hidden    ${result.deactivated.length}`)
    for (const slug of result.deactivated) console.log(`  - ${slug}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
