import { z } from 'zod'
import { isNormalizableIndianMobile } from '@/utils/phone'

/** Mirrors backend/src/checkout/dto/create-order.dto.ts's rules — a UX
 * convenience only, the server re-validates (and re-normalises the phone
 * to canonical E.164) independently.
 *
 * Phone is validated loosely here (any shape that normalises to a valid
 * Indian mobile passes); the canonical `+91XXXXXXXXXX` conversion happens
 * at submit time in CheckoutPage, alongside the other payload shaping, so
 * these values stay all-strings for react-hook-form. PIN is a strict
 * 6-digit format check — existence is resolved separately by the postal
 * lookup. */
export const shippingSchema = z.object({
  shippingRecipientName: z.string().trim().min(1, 'Recipient name is required').max(160),
  shippingPhone: z
    .string()
    .trim()
    .min(1, 'Phone number is required')
    .max(20)
    .refine(isNormalizableIndianMobile, 'Enter a valid Indian mobile number, e.g. 9876543210'),
  shippingAddressLine1: z.string().trim().min(1, 'Address is required').max(200),
  shippingAddressLine2: z.string().trim().max(200).optional().or(z.literal('')),
  shippingCity: z.string().trim().min(1, 'City is required').max(100),
  shippingState: z.string().trim().min(1, 'State is required').max(100),
  shippingPostalCode: z
    .string()
    .trim()
    .min(1, 'Postal code is required')
    .regex(/^\d{6}$/, 'Enter a valid 6-digit PIN code.'),
  shippingCountry: z.string().trim().min(1, 'Country is required').max(100),
  /** Optional delivery pin — set only if the customer chose to share one. */
  shippingLatitude: z.number().min(-90).max(90).optional(),
  shippingLongitude: z.number().min(-180).max(180).optional(),
})

export type ShippingFormValues = z.infer<typeof shippingSchema>
