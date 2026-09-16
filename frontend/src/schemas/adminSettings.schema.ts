import { z } from 'zod'

/**
 * Client-side convenience validation for the admin settings form. The
 * server (backend/src/app-setting/app-setting.constants.ts) re-validates
 * every value independently and is the authority — this only gives fast
 * inline feedback and mirrors those rules.
 */

const MONEY_PATTERN = /^\d+(\.\d{1,2})?$/
export const ANNOUNCEMENT_MAX_LENGTH = 200

export const moneySchema = z.object({
  value: z
    .string()
    .trim()
    .min(1, 'Enter a value (use 0 for free)')
    .regex(
      MONEY_PATTERN,
      'Must be a non-negative amount with at most 2 decimal places',
    )
    .refine((v) => Number(v) <= 100000, 'That amount is too large'),
})

/** GST %: 0–100, up to 2 decimals. */
export const percentSchema = z.object({
  value: z
    .string()
    .trim()
    .regex(MONEY_PATTERN, 'Enter a percentage between 0 and 100')
    .refine((v) => Number(v) >= 0 && Number(v) <= 100, 'Must be between 0 and 100'),
})

export const booleanSchema = z.object({
  value: z.enum(['true', 'false']),
})

/** Text (announcement, seller identity fields, invoice prefix). The
 * server enforces the per-field length / format; this only bounds it
 * generously. */
export const textSchema = z.object({
  value: z.string().trim().max(500, 'Too long'),
})

export const longTextSchema = z.object({
  value: z.string().max(8000, 'Too long'),
})

export const STORE_NAME_MAX_LENGTH = 60

/** `storeName` is the one text setting that is required — an empty value
 * would blank the storefront header / hero / footer. Mirrors the server
 * rule in backend/src/app-setting/app-setting.constants.ts. */
export const storeNameSchema = z.object({
  value: z
    .string()
    .trim()
    .min(1, 'Store name is required')
    .max(STORE_NAME_MAX_LENGTH, `Store name cannot exceed ${STORE_NAME_MAX_LENGTH} characters`),
})

/** Enum values are constrained to the option list at the field level. */
export const enumSchema = z.object({
  value: z.string().trim().min(1, 'Choose a value'),
})

export type SettingKind = 'money' | 'text' | 'boolean' | 'enum' | 'percent'

export const storeLogoSchema = z.object({
  value: z
    .string()
    .trim()
    .max(2048, 'Too long')
    .refine(
      (v) =>
        v === '' ||
        /^https?:\/\//i.test(v) ||
        v.startsWith('/'),
      'Logo must be an http(s) URL or a site path',
    ),
})

export function schemaForKind(kind: SettingKind, key?: string) {
  // A few settings need a rule stricter than their `kind` implies.
  if (key === 'storeName') return storeNameSchema
  if (key === 'storeLogo') return storeLogoSchema
  if (key === 'hero_slides' || key === 'brand_story' || key === 'featured_media' || key === 'storeAddress') {
    return longTextSchema
  }
  switch (kind) {
    case 'money':
      return moneySchema
    case 'percent':
      return percentSchema
    case 'boolean':
      return booleanSchema
    case 'enum':
      return enumSchema
    default:
      return textSchema
  }
}
