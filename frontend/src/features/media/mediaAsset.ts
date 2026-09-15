import type { Product, ProductImage } from '@/types/catalog'

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
