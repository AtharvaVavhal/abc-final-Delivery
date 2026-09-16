import type { Product, ProductImage } from '@/types/catalog'

const CLOUDINARY_UPLOAD =
  /^(https:\/\/res\.cloudinary\.com\/[^/]+\/(?:image|video)\/upload\/)(.+)$/i

/**
 * Insert `f_auto,q_auto,c_limit,w_*` after `/upload/` on unsigned Cloudinary
 * delivery URLs so cards never pull the original asset. Signed URLs and
 * already-transformed URLs are left untouched.
 */
export function optimizedCloudinaryUrl(url: string, width: number): string {
  if (!url || !Number.isFinite(width) || width <= 0) return url
  const match = url.match(CLOUDINARY_UPLOAD)
  if (!match) return url
  const rest = match[2]
  if (rest.startsWith('s--')) return url
  if (/^(?:f_auto|q_auto|c_limit|w_\d+|c_fill|c_fit)/.test(rest)) return url
  return `${match[1]}f_auto,q_auto,c_limit,w_${Math.round(width)}/${rest}`
}

export function isVideoAsset(image: Pick<ProductImage, 'resourceType' | 'url'>): boolean {
  if (image.resourceType.toLowerCase() === 'video') return true
  const url = image.url.toLowerCase()
  return url.includes('/video/upload/') || /\.(mp4|webm|mov)(\?|$)/.test(url)
}

export function isVideoUrl(url: string | undefined | null): boolean {
  if (!url) return false
  const value = url.toLowerCase()
  return value.includes('/video/upload/') || /\.(mp4|webm|mov)(\?|$)/.test(value)
}

export function stillImageUrl(product: Product | undefined): string {
  if (!product) return ''
  const stills = product.images.filter((image) => image.url && !isVideoAsset(image))
  const primary = stills.find((image) => image.isPrimary)
  return primary?.url ?? stills[0]?.url ?? ''
}

export function videoUrl(product: Product | undefined): string {
  if (!product) return ''
  return product.images.find((image) => isVideoAsset(image) && image.url)?.url ?? ''
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

export function prefersSaveData(): boolean {
  if (typeof navigator === 'undefined') return false
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean }
    }
  ).connection
  return Boolean(connection?.saveData)
}

export function shouldAutoplayVideo(): boolean {
  return !prefersReducedMotion() && !prefersSaveData()
}
