/**
 * Provenance keys stored on Identica catalog rows. They are not customer-
 * facing product attributes — Listing is the storefront URL on
 * abcmanufactures.com, not a material/size spec.
 */
export const HIDDEN_SPEC_KEYS = new Set(['Source', 'Listing'])

export function visibleSpecEntries(
  specifications: Record<string, unknown> | null | undefined,
): [string, unknown][] {
  if (!specifications) return []
  return Object.entries(specifications).filter(([key]) => !HIDDEN_SPEC_KEYS.has(key))
}
