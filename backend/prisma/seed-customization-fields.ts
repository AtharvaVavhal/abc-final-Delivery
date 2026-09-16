import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CustomizationFieldType,
  Prisma,
  PrismaClient,
  SurchargeType,
} from '@prisma/client'
import { withPlatformRlsBypass } from '../src/common/tenant/tenant-rls'
import type { PrismaService } from '../src/common/database/prisma.service'

/**
 * Idempotent per-product customization fields so storefront checkout can
 * collect photos, names, logos, and notes that match the product type.
 *
 *   npx ts-node prisma/seed-customization-fields.ts
 */

loadLocalEnv()

interface FieldSpec {
  label: string
  type: CustomizationFieldType
  isRequired: boolean
  sortOrder: number
  helpText?: string
  constraints?: Record<string, unknown>
}

const PHOTO_CONSTRAINTS = { allowedFormats: ['png', 'jpeg'], maxFileSizeMb: 8 }
const LOGO_CONSTRAINTS = { allowedFormats: ['png', 'jpeg', 'pdf'], maxFileSizeMb: 5 }
const DESIGN_CONSTRAINTS = { allowedFormats: ['png', 'jpeg', 'pdf'], maxFileSizeMb: 10 }

function photo(
  label = 'Photo',
  sortOrder = 0,
  isRequired = true,
  helpText = 'JPEG or PNG, at least 1000px on the long edge for a crisp print.',
): FieldSpec {
  return {
    label,
    type: CustomizationFieldType.IMAGE_UPLOAD,
    isRequired,
    sortOrder,
    helpText,
    constraints: PHOTO_CONSTRAINTS,
  }
}

function notes(sortOrder = 20): FieldSpec {
  return {
    label: 'Special instructions',
    type: CustomizationFieldType.INSTRUCTIONS,
    isRequired: false,
    sortOrder,
    helpText: 'Cropping, orientation, or anything the studio should know.',
    constraints: { maxLength: 200 },
  }
}

function text(
  label: string,
  sortOrder: number,
  isRequired: boolean,
  maxLength: number,
  helpText?: string,
): FieldSpec {
  return {
    label,
    type: CustomizationFieldType.TEXT,
    isRequired,
    sortOrder,
    helpText,
    constraints: { maxLength },
  }
}

function logo(sortOrder = 0, isRequired = true): FieldSpec {
  return {
    label: 'Logo',
    type: CustomizationFieldType.LOGO_UPLOAD,
    isRequired,
    sortOrder,
    helpText: 'PNG, JPEG, or PDF. Transparent PNG prints cleanest on fabric and metal.',
    constraints: LOGO_CONSTRAINTS,
  }
}

function design(sortOrder = 0, isRequired = true): FieldSpec {
  return {
    label: 'Artwork file',
    type: CustomizationFieldType.DESIGN_FILE_UPLOAD,
    isRequired,
    sortOrder,
    helpText: 'High-resolution PNG, JPEG, or PDF of the logo or final layout.',
    constraints: DESIGN_CONSTRAINTS,
  }
}

const PHOTO_AND_NOTES = [photo(), notes()]

const BY_CATEGORY: Record<string, FieldSpec[]> = {
  'acrylic-photos': PHOTO_AND_NOTES,
  'acrylic-cutouts': PHOTO_AND_NOTES,
  'acrylic-caricatures': [
    photo(
      'Reference photo',
      0,
      true,
      'A clear, well-lit photo of the people to caricature.',
    ),
    photo('Additional photo', 1, false, 'Optional extra angle or person.'),
    notes(2),
  ],
  'acrylic-clocks': PHOTO_AND_NOTES,
  'acrylic-wall-art': PHOTO_AND_NOTES,
  'acrylic-photo-frames': PHOTO_AND_NOTES,
  'acrylic-standees': PHOTO_AND_NOTES,
  'fridge-magnets': [
    photo(),
    text('Caption', 1, false, 40, 'Short line printed under the photo, if you want one.'),
    notes(2),
  ],
  'key-car-photos': PHOTO_AND_NOTES,
  'dashboard-photos': PHOTO_AND_NOTES,
  'car-hanging-photos': PHOTO_AND_NOTES,
  'illusion-lamps': PHOTO_AND_NOTES,
  mugs: [
    photo(),
    text('Caption', 1, false, 40, 'Optional short line on the mug.'),
    notes(2),
  ],
  bottles: [
    photo('Photo or artwork', 0, true, 'Photo or graphic to print on the bottle.'),
    text('Name or text', 1, false, 40),
    notes(2),
  ],
  diaries: [
    photo('Cover photo or artwork', 0, true),
    text('Name or title on cover', 1, false, 40),
    notes(2),
  ],
  't-shirts': [
    photo('Print artwork', 0, true, 'The image or design to print on the shirt.'),
    text('Text on shirt', 1, false, 40),
    notes(2),
  ],
  pens: [text('Name or message', 0, true, 30, 'Printed or engraved on the pen.'), notes(1)],
  'name-plates': [
    text('Name', 0, true, 40, 'The name shown on the plate.'),
    text('Second line', 1, false, 40, 'House name, title, or short line under the name.'),
    notes(2),
  ],
  'divine-frames': [
    text('Gift message or name', 0, false, 80, 'Optional line for a gift or dedication.'),
    notes(1),
  ],
  clocks: PHOTO_AND_NOTES,
  'wall-art': PHOTO_AND_NOTES,
  'corporate-t-shirts': [
    logo(),
    text('Chest or back text', 1, false, 40),
    notes(2),
  ],
  badges: [
    logo(0, false),
    text('Name', 1, true, 40),
    text('Title', 2, false, 40),
    notes(3),
  ],
  'corporate-pens': [
    logo(0, false),
    text('Company name or message', 1, true, 40),
    notes(2),
  ],
  'corporate-bottles': [logo(), text('Name or department', 1, false, 40), notes(2)],
  'corporate-diaries': [logo(), text('Name or title on cover', 1, false, 40), notes(2)],
  trophies: [
    text('Recipient name', 0, true, 40),
    text('Award title', 1, false, 60),
    notes(2),
  ],
  'banner-printing': [design(), notes(1)],
  'vinyl-printing': [design(), notes(1)],
}

const SIGNAGE_NAME_PLATE: FieldSpec[] = [
  text('Name or wording', 0, true, 80, 'The name or line shown on the plate.'),
  text('Second line', 1, false, 80, 'Title, department, or house name.'),
  logo(2, false),
  design(3, false),
  notes(4),
]

const SIGNAGE_LETTERS: FieldSpec[] = [
  text(
    'Lettering / company name',
    0,
    true,
    80,
    'The wording that should appear in the letters.',
  ),
  logo(1, false),
  design(2, false),
  notes(3),
]

const SIGNAGE_LOGO: FieldSpec[] = [
  logo(0, true),
  design(1, false),
  text('Brand or company name', 2, false, 80),
  notes(3),
]

const SIGNAGE_ARTWORK: FieldSpec[] = [
  design(0, true),
  logo(1, false),
  text('Brand or company name', 2, false, 80),
  notes(3),
]

/** Leaf or group slugs whose parent is not already this template. */
const NAME_PLATE_SLUGS = new Set([
  'signage-name-plates',
  'office-name-plate',
  'acrylic-office-name-board',
  'stainless-steel-metal-labels',
])

const LETTER_SLUGS = new Set([
  'led-letters',
  'acrylic-box-solid-letters',
  'solid-letters',
  'stainless-steel-3d-letters',
  'metal-brass-3d-solid-letter',
  'acrylic-led-letter',
  '3d-box-letter',
  'rose-gold-letter',
  'ss-signage-letters',
  'led-box-type-letters',
  'led-backlite-letters',
  'acrylic-box-letters',
  'letter-signage-board',
  'acrylic-letters-signs',
  'letter-sign-boards',
  'acrylic-solid-letter',
  'acrylic-and-metal-letter',
  'cladding-with-3d-letters-signage',
])

const LOGO_SLUGS = new Set(['led-signages-logo'])

const ARTWORK_SLUGS = new Set([
  'graphics-service',
  'uv-printing-services',
  'flex-branding-work',
])

const BY_SLUG: Record<string, FieldSpec[]> = {
  'acrylic-photo-standee-4-photos-5mm': [
    photo('Photo 1', 0),
    photo('Photo 2', 1),
    photo('Photo 3', 2),
    photo('Photo 4', 3),
    notes(4),
  ],
  'premium-acrylic-photo-standee-with-quote-paps01': [
    photo(),
    text('Quote', 1, true, 80, 'The line printed on the standee.'),
    notes(2),
  ],
  'premium-acrylic-photo-standee-with-quote-paps03': [
    photo(),
    text('Quote', 1, true, 80, 'The line printed on the standee.'),
    notes(2),
  ],
}

function fieldsForCategory(categorySlug: string | null | undefined): FieldSpec[] | null {
  if (!categorySlug) return null
  if (BY_CATEGORY[categorySlug]) return BY_CATEGORY[categorySlug]
  if (NAME_PLATE_SLUGS.has(categorySlug)) return SIGNAGE_NAME_PLATE
  if (LETTER_SLUGS.has(categorySlug)) return SIGNAGE_LETTERS
  if (LOGO_SLUGS.has(categorySlug)) return SIGNAGE_LOGO
  if (ARTWORK_SLUGS.has(categorySlug)) return SIGNAGE_ARTWORK
  return null
}

function fieldsFor(
  slug: string,
  categorySlug: string,
  parentCategorySlug?: string | null,
): FieldSpec[] | null {
  if (BY_SLUG[slug]) return BY_SLUG[slug]
  if (slug === 'brass-pocket-badges' || categorySlug === 'brass-pocket-badges') {
    return BY_CATEGORY.badges
  }
  const fromLeaf = fieldsForCategory(categorySlug)
  if (fromLeaf) return fromLeaf
  const fromParent = fieldsForCategory(parentCategorySlug)
  if (fromParent) return fromParent
  if (slug.startsWith('identica-')) return SIGNAGE_ARTWORK
  return [notes(0)]
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

function sameConstraints(
  left: Prisma.JsonValue | null,
  right: Record<string, unknown> | undefined,
): boolean {
  const a = JSON.stringify(left ?? null)
  const b = JSON.stringify(right ?? null)
  return a === b
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

        const products = await tx.product.findMany({
          where: { tenantId: tenant.id, isActive: true },
          include: {
            category: {
              select: {
                slug: true,
                parentCategory: { select: { slug: true } },
              },
            },
            customizationFields: true,
          },
        })

        const created: string[] = []
        const updated: string[] = []
        const skipped: string[] = []
        const toCreate: Prisma.CustomizationFieldCreateManyInput[] = []

        for (const product of products) {
          const wanted = fieldsFor(
            product.slug,
            product.category.slug,
            product.category.parentCategory?.slug,
          )
          if (!wanted) {
            skipped.push(product.slug)
            continue
          }

          const byLabel = new Map(product.customizationFields.map((row) => [row.label, row]))
          let productTouched = false

          for (const spec of wanted) {
            const existing = byLabel.get(spec.label)
            if (existing) continue

            toCreate.push({
              productId: product.id,
              label: spec.label,
              type: spec.type,
              isRequired: spec.isRequired,
              sortOrder: spec.sortOrder,
              helpText: spec.helpText ?? null,
              constraints: (spec.constraints ?? Prisma.JsonNull) as Prisma.InputJsonValue,
              surchargeType: SurchargeType.NONE,
              surchargeAmount: 0,
              tenantId: tenant.id,
              storeId: product.storeId,
            })
            created.push(`${product.slug} / ${spec.label}`)
            productTouched = true
          }

          if (!productTouched) skipped.push(product.slug)
        }

        const chunkSize = 200
        for (let i = 0; i < toCreate.length; i += chunkSize) {
          await tx.customizationField.createMany({
            data: toCreate.slice(i, i + chunkSize),
          })
        }

        return { created, updated, skipped }
      },
      { maxWait: 15_000, timeout: 180_000 },
    )

    console.log(`created ${result.created.length}`)
    for (const line of result.created.slice(0, 12)) console.log(`  + ${line}`)
    if (result.created.length > 12) {
      console.log(`  … ${result.created.length - 12} more`)
    }
    console.log(`updated ${result.updated.length}`)
    console.log(`unchanged/skipped ${result.skipped.length}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
