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

function design(sortOrder = 0): FieldSpec {
  return {
    label: 'Artwork file',
    type: CustomizationFieldType.DESIGN_FILE_UPLOAD,
    isRequired: true,
    sortOrder,
    helpText: 'High-resolution PNG, JPEG, or PDF of the final print layout.',
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

function fieldsFor(slug: string, categorySlug: string): FieldSpec[] | null {
  if (BY_SLUG[slug]) return BY_SLUG[slug]
  if (BY_CATEGORY[categorySlug]) return BY_CATEGORY[categorySlug]
  return null
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
            category: { select: { slug: true } },
            customizationFields: true,
          },
        })

        const created: string[] = []
        const updated: string[] = []
        const skipped: string[] = []

        for (const product of products) {
          const wanted = fieldsFor(product.slug, product.category.slug)
          if (!wanted) {
            skipped.push(product.slug)
            continue
          }

          const byLabel = new Map(product.customizationFields.map((row) => [row.label, row]))
          let productTouched = false

          for (const spec of wanted) {
            const existing = byLabel.get(spec.label)
            if (!existing) {
              await tx.customizationField.create({
                data: {
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
                },
              })
              created.push(`${product.slug} / ${spec.label}`)
              productTouched = true
              continue
            }

            const needsUpdate =
              existing.type !== spec.type ||
              existing.isRequired !== spec.isRequired ||
              existing.sortOrder !== spec.sortOrder ||
              (existing.helpText ?? null) !== (spec.helpText ?? null) ||
              !sameConstraints(existing.constraints, spec.constraints)

            if (!needsUpdate) continue

            await tx.customizationField.update({
              where: { id: existing.id },
              data: {
                type: spec.type,
                isRequired: spec.isRequired,
                sortOrder: spec.sortOrder,
                helpText: spec.helpText ?? null,
                constraints: (spec.constraints ?? Prisma.JsonNull) as Prisma.InputJsonValue,
                storeId: existing.storeId ?? product.storeId,
              },
            })
            updated.push(`${product.slug} / ${spec.label}`)
            productTouched = true
          }

          if (!productTouched) skipped.push(product.slug)
        }

        return { created, updated, skipped }
      },
      { maxWait: 15_000, timeout: 120_000 },
    )

    console.log(`created ${result.created.length}`)
    for (const line of result.created) console.log(`  + ${line}`)
    console.log(`updated ${result.updated.length}`)
    for (const line of result.updated) console.log(`  ~ ${line}`)
    console.log(`unchanged/skipped ${result.skipped.length}`)
    for (const slug of result.skipped) console.log(`  = ${slug}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
