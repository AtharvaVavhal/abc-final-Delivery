import { useId, useRef, useState } from 'react'
import { useUploadFile } from '@/hooks/useUploadFile'
import { useAddProductImage } from '@/hooks/useAddProductImage'
import { useRemoveProductImage } from '@/hooks/useRemoveProductImage'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Alert'
import { Modal } from '@/components/ui/Modal'
import { AdminBadge } from '@/components/admin/AdminBadge'
import { AdminEmptyState } from '@/components/admin/AdminEmptyState'
import { getApiErrorMessage } from '@/utils/apiError'
import type { ProductImage } from '@/types/catalog'
import { isVideoAsset } from '@/features/media/mediaAsset'
import styles from './ProductImageManager.module.css'

interface ProductImageManagerProps {
  productId: string
  images: ProductImage[]
  onImagesChange: (images: ProductImage[]) => void
}

/**
 * Reuses useUploadFile (POST /uploads) then POST /products/:id/images —
 * no single combined endpoint exists. Removal is a real
 * DELETE /products/:id/images/:imageId, so it goes through a confirmation.
 */
export function ProductImageManager({ productId, images, onImagesChange }: ProductImageManagerProps) {
  const headingId = useId()
  const uploadFile = useUploadFile()
  const addImage = useAddProductImage(productId)
  const removeImage = useRemoveProductImage(productId)
  const [error, setError] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFileSelected(file: File) {
    setError(null)
    try {
      const uploaded = await uploadFile.mutateAsync(file)
      const created = await addImage.mutateAsync({
        uploadedFileId: uploaded.id,
        sortOrder: images.length,
        isPrimary: images.length === 0,
      })
      onImagesChange([...images, created])
    } catch (err) {
      setError(getApiErrorMessage(err))
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleRemove(imageId: string) {
    setError(null)
    setRemovingId(imageId)
    try {
      await removeImage.mutateAsync(imageId)
      onImagesChange(images.filter((image) => image.id !== imageId))
    } catch (err) {
      setError(getApiErrorMessage(err))
    } finally {
      setRemovingId(null)
      setPendingRemoveId(null)
    }
  }

  const isUploading = uploadFile.isPending || addImage.isPending

  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <div className={styles.header}>
        <h2 id={headingId} className={styles.heading}>
          Images &amp; videos
        </h2>
        <Button
          type="button"
          variant="secondary"
          isLoading={isUploading}
          onClick={() => fileInputRef.current?.click()}
        >
          Upload media
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,video/mp4,video/webm"
          className={styles.hiddenInput}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void handleFileSelected(file)
          }}
        />
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {images.length === 0 ? (
        <AdminEmptyState
          title="No images yet"
          description="Upload a PNG, JPEG, MP4, or WebM. The first file becomes the primary asset. Short loops work best for Watch & Buy."
        />
      ) : (
        <ul className={styles.grid}>
          {images.map((image) => (
            <li key={image.id} className={styles.tile}>
              {isVideoAsset(image) ? (
                <video
                  src={image.url}
                  className={styles.thumbnail}
                  muted
                  playsInline
                  preload="metadata"
                  aria-label={image.isPrimary ? 'Primary product video' : 'Product video'}
                />
              ) : (
                <img
                  src={image.url}
                  alt={image.isPrimary ? 'Primary product image' : 'Product image'}
                  className={styles.thumbnail}
                />
              )}
              {image.isPrimary && (
                <span className={styles.primaryFlag}>
                  <AdminBadge variant="success">Primary</AdminBadge>
                </span>
              )}
              <Button
                type="button"
                variant="secondary"
                className={styles.removeButton}
                isLoading={removingId === image.id}
                onClick={() => setPendingRemoveId(image.id)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Modal
        isOpen={pendingRemoveId !== null}
        onClose={() => setPendingRemoveId(null)}
        title="Remove this image?"
        size="sm"
      >
        <div className={styles.confirm}>
          <p>The image is deleted permanently. This does not affect any orders that already used it.</p>
          <div className={styles.confirmActions}>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setPendingRemoveId(null)}
              disabled={removeImage.isPending}
            >
              Keep image
            </Button>
            <Button
              type="button"
              isLoading={removeImage.isPending}
              onClick={() => {
                if (pendingRemoveId) void handleRemove(pendingRemoveId)
              }}
            >
              Remove image
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  )
}
