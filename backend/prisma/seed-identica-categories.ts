import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PrismaClient, type Category } from '@prisma/client'
import { withPlatformRlsBypass } from '../src/common/tenant/tenant-rls'
import type { PrismaService } from '../src/common/database/prisma.service'

/**
 * Idempotent Identica category tree from
 * https://www.mahakaladvertising.com/ Products & Services.
 * Adds groups/subcategories; does not hide existing gift categories or
 * invent products.
 *
 *   npx ts-node prisma/seed-identica-categories.ts
 */

loadLocalEnv()

interface ChildSpec {
  name: string
  slug: string
}

interface GroupSpec {
  name: string
  slug: string
  children: ChildSpec[]
}

/** Unique names only — IndiaMART repeats many product titles. */
const TREE: GroupSpec[] = [
  {
    name: 'Corporate Signage',
    slug: 'corporate-signage',
    children: [
      { name: 'Directional Acrylic Sign Board', slug: 'directional-acrylic-sign-board' },
      { name: 'Office Name Plate', slug: 'office-name-plate' },
      { name: 'Corporate LED Signage', slug: 'corporate-led-signage' },
      { name: 'Stainless Steel 3D Letters', slug: 'stainless-steel-3d-letters' },
      { name: 'Wayfinding Sign Board', slug: 'wayfinding-sign-board' },
      { name: 'Metal Brass 3D Solid Letter', slug: 'metal-brass-3d-solid-letter' },
      { name: 'Acrylic LED Letter', slug: 'acrylic-led-letter' },
      { name: '3D Box Letter', slug: '3d-box-letter' },
      { name: 'Rose Gold Letter', slug: 'rose-gold-letter' },
      { name: 'Reception Signage Board', slug: 'reception-signage-board' },
      { name: 'SS Corporate Signage', slug: 'ss-corporate-signage' },
      { name: 'Acrylic Office Name Board', slug: 'acrylic-office-name-board' },
    ],
  },
  {
    name: 'LED Signages',
    slug: 'led-signages',
    children: [
      { name: 'Outdoor Sign Board', slug: 'outdoor-sign-board' },
      { name: 'Acrylic Signage', slug: 'acrylic-signage' },
      { name: 'LED Box Type Letters', slug: 'led-box-type-letters' },
      { name: 'SS Signage Letters', slug: 'ss-signage-letters' },
      { name: 'Retail Signage Boards', slug: 'retail-signage-boards' },
      { name: 'LED Backlite Letters', slug: 'led-backlite-letters' },
      { name: 'Exterior Signs', slug: 'exterior-signs' },
      { name: 'General LED Signage', slug: 'general-led-signage' },
    ],
  },
  {
    name: 'LED Letters',
    slug: 'led-letters',
    children: [
      { name: 'LED Signage Letter', slug: 'led-signage-letter' },
      { name: '3D LED Letter', slug: '3d-led-letter' },
      { name: 'Metal Channelium Letters', slug: 'metal-channelium-letters' },
      { name: 'LED Acrylic Letters', slug: 'led-acrylic-letters' },
      { name: 'CU Continental Signage System', slug: 'cu-continental-signage-system' },
      { name: 'Channel Signs Letters', slug: 'channel-signs-letters' },
      { name: 'Side Light Letters', slug: 'side-light-letters' },
      { name: 'Brass Signage Letter', slug: 'brass-signage-letter' },
      { name: 'Acrylic LED Glow Letters', slug: 'acrylic-led-glow-letters' },
      { name: 'Outdoor Signage Letter', slug: 'outdoor-signage-letter' },
    ],
  },
  {
    name: 'LED Signage Board',
    slug: 'led-signage-board',
    children: [
      { name: 'Letter Signage Board', slug: 'letter-signage-board' },
      { name: '3D Acrylic LED Sign Board', slug: '3d-acrylic-led-sign-board' },
      { name: 'Office Signage Board', slug: 'office-signage-board' },
      { name: 'Acrylic Box Letters', slug: 'acrylic-box-letters' },
    ],
  },
  {
    name: 'Office & Building Signage Board',
    slug: 'office-and-building-signage-board',
    children: [
      { name: '3D LED Signages Board', slug: '3d-led-signages-board' },
      { name: '3D LED Sign Board', slug: '3d-led-sign-board' },
      { name: 'Acrylic Letters Signs', slug: 'acrylic-letters-signs' },
    ],
  },
  {
    name: 'Retail Signages',
    slug: 'retail-signages',
    children: [
      { name: 'Restaurant Menu Sign Board', slug: 'restaurant-menu-sign-board' },
      { name: 'Acrylic Sign Board', slug: 'acrylic-sign-board' },
      { name: 'Letter Sign Boards', slug: 'letter-sign-boards' },
      { name: 'Stainless Steel Sign Board', slug: 'stainless-steel-sign-board' },
    ],
  },
  {
    name: 'LED Sign Board',
    slug: 'led-sign-board',
    children: [
      { name: '3D Acrylic Sign Board', slug: '3d-acrylic-sign-board' },
      { name: 'Outdoor Signage Board', slug: 'outdoor-signage-board' },
      { name: 'Acrylic Sign Boards', slug: 'acrylic-sign-boards' },
    ],
  },
  {
    name: 'Name Plates',
    slug: 'signage-name-plates',
    children: [
      { name: 'Door Name Plate', slug: 'door-name-plate' },
      { name: 'Stainless Steel Name Plate', slug: 'stainless-steel-name-plate' },
      { name: 'Meeting Room Name Plate', slug: 'meeting-room-name-plate' },
      { name: 'Glass Nameplate with Vinyl', slug: 'glass-nameplate-with-vinyl' },
      { name: 'Name Plate Directory', slug: 'name-plate-directory' },
      { name: 'Room Number Plate', slug: 'room-number-plate' },
      { name: 'Brass Name Plates', slug: 'brass-name-plates' },
      { name: 'Corporate Name Plate', slug: 'corporate-name-plate' },
      { name: 'Acrylic Stainless Steel Name Plate', slug: 'acrylic-stainless-steel-name-plate' },
      { name: 'Name Plate Lobby Area', slug: 'name-plate-lobby-area' },
      { name: 'Aluminum Nameplates', slug: 'aluminum-nameplates' },
      { name: 'Etching Name Plates', slug: 'etching-name-plates' },
      { name: 'Transparent Acrylic Name Plate', slug: 'transparent-acrylic-name-plate' },
    ],
  },
  {
    name: 'Pylons Lolipop',
    slug: 'pylons-lolipop',
    children: [
      { name: 'Vertical Pylon Signage', slug: 'vertical-pylon-signage' },
      { name: 'LED Pylon Signage', slug: 'led-pylon-signage' },
      { name: 'Signage Board Stand Outdoor', slug: 'signage-board-stand-outdoor' },
      { name: 'ACP Pylon Signage', slug: 'acp-pylon-signage' },
      { name: '4A External Directional Signage', slug: '4a-external-directional-signage' },
      { name: 'Pylon Lollypop Signage', slug: 'pylon-lollypop-signage' },
      { name: 'Pole Display', slug: 'pole-display' },
    ],
  },
  {
    name: 'Acrylic Box Solid Letters',
    slug: 'acrylic-box-solid-letters',
    children: [
      { name: 'Acrylic Signage Board', slug: 'acrylic-signage-board' },
      { name: 'ACP Glow Signage', slug: 'acp-glow-signage' },
      { name: 'Acrylic Solid Letter', slug: 'acrylic-solid-letter' },
      { name: 'Acrylic & Metal Letter', slug: 'acrylic-and-metal-letter' },
    ],
  },
  {
    name: 'Solid Letters',
    slug: 'solid-letters',
    children: [
      { name: 'Retail 3D Signages', slug: 'retail-3d-signages' },
      { name: 'Acrylic Backlit 3D Letter Sign Board', slug: 'acrylic-backlit-3d-letter-sign-board' },
      { name: 'Led Signage Board', slug: 'solid-led-signage-board' },
    ],
  },
  {
    name: 'LED Signages Logo',
    slug: 'led-signages-logo',
    children: [
      { name: 'LED Restaurant Signage Logo', slug: 'led-restaurant-signage-logo' },
      { name: 'LED Face Signage Logo', slug: 'led-face-signage-logo' },
      { name: 'LED Signages Logo', slug: 'led-signages-logo-mark' },
    ],
  },
  {
    name: 'Safety Signs',
    slug: 'safety-signs',
    children: [
      { name: 'Fire Safety Signs', slug: 'fire-safety-signs' },
      { name: 'Safety Sign Board', slug: 'safety-sign-board' },
      { name: 'Acrylic Displays Signage', slug: 'acrylic-displays-signage' },
      { name: 'Warning Sign Board', slug: 'warning-sign-board' },
      { name: 'ACP Sign Boards', slug: 'acp-sign-boards' },
    ],
  },
  {
    name: 'Graphics Service',
    slug: 'graphics-service',
    children: [
      { name: 'Wall Graphics Pasting', slug: 'wall-graphics-pasting' },
      { name: 'Wall Graphics Stickers', slug: 'wall-graphics-stickers' },
      { name: 'Corporate Office Wall Graphics', slug: 'corporate-office-wall-graphics' },
      { name: 'Wall Graphics Vinyl', slug: 'wall-graphics-vinyl' },
      { name: 'Wall Graphics Printing Service', slug: 'wall-graphics-printing-service' },
    ],
  },
  {
    name: 'Sky Signages',
    slug: 'sky-signages',
    children: [
      { name: 'Building Rooftop Signages', slug: 'building-rooftop-signages' },
      { name: '3D LED Sky Signage', slug: '3d-led-sky-signage' },
      { name: 'Sky Signage', slug: 'sky-signage' },
    ],
  },
  {
    name: 'Digital Standee',
    slug: 'digital-standee',
    children: [
      { name: 'Digital Standee Advertising Board', slug: 'digital-standee-advertising-board' },
      { name: 'Digital Display Standee', slug: 'digital-display-standee' },
      { name: 'Digital Board Stand', slug: 'digital-board-stand' },
      { name: 'Digital LED Standee', slug: 'digital-led-standee' },
      { name: 'LED Video Wall & Digital Display Solutions', slug: 'led-video-wall-digital-display' },
    ],
  },
  {
    name: 'Glow Signs',
    slug: 'glow-signs',
    children: [
      { name: 'Clip On Board', slug: 'clip-on-board' },
      { name: 'Glow Sign Board', slug: 'glow-sign-board' },
      { name: 'ACP Glow Sign Board', slug: 'acp-glow-sign-board' },
      { name: 'Slim Aluminum Clip On LED Backlit Frame', slug: 'slim-aluminum-clip-on-led-backlit-frame' },
    ],
  },
  {
    name: 'Metal Labels',
    slug: 'metal-labels',
    children: [
      { name: 'Stainless Steel Metal Labels', slug: 'stainless-steel-metal-labels' },
      { name: 'Brass Pocket Badges', slug: 'brass-pocket-badges' },
    ],
  },
  {
    name: 'Cladding Work',
    slug: 'cladding-work',
    children: [
      { name: 'ACP Cladding Work', slug: 'acp-cladding-work' },
      { name: 'Cladding With 3D Letters Signage', slug: 'cladding-with-3d-letters-signage' },
    ],
  },
  {
    name: 'UV Printing Services',
    slug: 'uv-printing-services',
    children: [
      { name: 'UV Printing Service', slug: 'uv-printing-service' },
      { name: 'UV Vinyl Printing Services', slug: 'uv-vinyl-printing-services' },
    ],
  },
  {
    name: 'Flex Branding Work',
    slug: 'flex-branding-work',
    children: [{ name: 'Flex Sign Board MS Frame', slug: 'flex-sign-board-ms-frame' }],
  },
  {
    name: 'Sign Board Poles',
    slug: 'sign-board-poles',
    children: [{ name: 'Median Pole for Branding', slug: 'median-pole-for-branding' }],
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

function assertUniqueSlugs(): void {
  const seen = new Set<string>()
  for (const group of TREE) {
    for (const spec of [group, ...group.children]) {
      if (seen.has(spec.slug)) {
        throw new Error(`Duplicate category slug in Identica tree: ${spec.slug}`)
      }
      seen.add(spec.slug)
    }
  }
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set')
  }
  assertUniqueSlugs()

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
          spec: { name: string; slug: string },
          parentId: string | null,
        ): Promise<Category> => {
          const found = bySlug.get(spec.slug)
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
          remember(row, found.slug)
          if (
            found.name !== spec.name ||
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

        return { created, updated }
      },
      { maxWait: 15_000, timeout: 90_000 },
    )

    console.log(`created   ${result.created.length}`)
    for (const slug of result.created) console.log(`  + ${slug}`)
    console.log(`updated   ${result.updated.length}`)
    for (const slug of result.updated) console.log(`  ~ ${slug}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
