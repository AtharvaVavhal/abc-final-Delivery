/**
 * Normalizes and formats category display names across the storefront,
 * correcting database typos (such as "name plats" -> "Name Plates", "logo" -> "Logo")
 * and ensuring consistent title casing.
 */
export function formatCategoryName(name: string | null | undefined): string {
  if (!name) return ''
  const trimmed = name.trim()
  const lower = trimmed.toLowerCase()

  if (
    lower === 'name plats' ||
    lower === 'name plat' ||
    lower === 'name plates' ||
    lower === 'name plate' ||
    lower === 'plats'
  ) {
    return 'Name Plates'
  }

  if (lower === 'logo') {
    return 'Logo'
  }

  if (lower === 'card' || lower === 'business cards' || lower === 'business-cards') {
    return 'Business Cards'
  }

  if (lower === 'mugs' || lower === 'mug') {
    return 'Mugs'
  }

  if (lower === 't-shirts' || lower === 't-shirt' || lower === 'tshirts' || lower === 'tshirt') {
    return 'T-Shirts'
  }

  // Capitalize first letter of each word if all lowercase
  if (trimmed === trimmed.toLowerCase()) {
    return trimmed.replace(/\b\w/g, (char) => char.toUpperCase())
  }

  return trimmed
}
