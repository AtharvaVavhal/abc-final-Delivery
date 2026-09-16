import { describe, expect, it } from 'vitest'
import { isVideoAsset, isVideoUrl, optimizedCloudinaryUrl, stillImageUrl } from './mediaAsset'
import type { Product, ProductImage } from '@/types/catalog'

function image(overrides: Partial<ProductImage> = {}): ProductImage {
  return {
    id: '1',
    productId: 'p',
    cloudinaryPublicId: 'x',
    resourceType: 'image',
    deliveryType: 'upload',
    url: 'https://cdn.test/a.png',
    sortOrder: 0,
    isPrimary: true,
    createdAt: '',
    ...overrides,
  }
}

describe('mediaAsset', () => {
  it('detects Cloudinary and file-extension videos', () => {
    expect(isVideoAsset(image({ resourceType: 'video', url: 'https://cdn/v' }))).toBe(true)
    expect(isVideoUrl('https://res.cloudinary.com/demo/video/upload/x.mp4')).toBe(true)
    expect(isVideoAsset(image())).toBe(false)
  })

  it('prefers a still image over a video for posters', () => {
    const product = {
      images: [
        image({ id: 'v', resourceType: 'video', url: 'https://cdn/x.mp4', isPrimary: true }),
        image({ id: 's', url: 'https://cdn/still.jpg', isPrimary: false }),
      ],
    } as Product
    expect(stillImageUrl(product)).toBe('https://cdn/still.jpg')
  })

  it('inserts Cloudinary transforms on unsigned delivery URLs and leaves others alone', () => {
    expect(optimizedCloudinaryUrl('https://res.cloudinary.com/demo/image/upload/abc.png', 640)).toBe(
      'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,c_limit,w_640/abc.png',
    )
    expect(
      optimizedCloudinaryUrl(
        'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto/abc.png',
        640,
      ),
    ).toBe('https://res.cloudinary.com/demo/image/upload/f_auto,q_auto/abc.png')
    expect(
      optimizedCloudinaryUrl('https://res.cloudinary.com/demo/image/upload/s--abc--/v1/x.png', 640),
    ).toBe('https://res.cloudinary.com/demo/image/upload/s--abc--/v1/x.png')
    expect(optimizedCloudinaryUrl('/catalog/logo.png', 640)).toBe('/catalog/logo.png')
  })
})
