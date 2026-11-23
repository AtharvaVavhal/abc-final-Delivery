import { useRef, useState } from 'react'
import { useReplaceOrderPhoto } from '@/hooks/useReplaceOrderPhoto'
import { getApiErrorMessage } from '@/utils/apiError'
import { Alert } from '@/components/ui/Alert'
import { photoReviewApplies } from '@/features/admin/photo-review/photoReviewLabels'
import type { OrderDetailView, OrderItemCustomizationView } from '@/types/orders'
import styles from './OrderPhotoStatus.module.css'

const MAX_BYTES = 10 * 1024 * 1024
const ACCEPT = 'image/jpeg,image/png,image/webp'

/** Fast, friendly pre-check; the server's file-signature check is the real gate. */
function validate(file: File): string | null {
  if (!ACCEPT.split(',').includes(file.type)) return 'Please choose a JPG, PNG or WebP image.'
  if (file.size > MAX_BYTES) return 'That image is larger than 10 MB. Please choose a smaller one.'
  return null
}

function PhotoRow({
  orderId,
  productName,
  photo,
  canReplace,
}: {
  orderId: string
  productName: string
  photo: OrderItemCustomizationView
  canReplace: boolean
}) {
  const replace = useReplaceOrderPhoto(orderId)
  const inputRef = useRef<HTMLInputElement>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const inputId = `replace-photo-${photo.id}`

  function onPick(file: File | undefined) {
    if (!file) return
    const problem = validate(file)
    setLocalError(problem)
    if (problem) return
    replace.mutate({ customizationId: photo.id, file })
  }

  if (photo.reviewStatus === 'CHANGES_REQUESTED') {
    return (
      <li className={styles.rowAttention}>
        <p className={styles.rowTitle}>
          {productName} — {photo.fieldLabel}
        </p>
        <p className={styles.statusAttention}>We need a new photo</p>
        {photo.reviewNote && <p className={styles.note}>{photo.reviewNote}</p>}
        {canReplace ? (
          <div className={styles.upload}>
            <label htmlFor={inputId} className={styles.uploadLabel}>
              Upload a new photo
            </label>
            <input
              ref={inputRef}
              id={inputId}
              type="file"
              accept={ACCEPT}
              disabled={replace.isPending}
              onChange={(e) => onPick(e.target.files?.[0])}
            />
            {replace.isPending && (
              <p role="status" className={styles.hint}>
                Uploading…
              </p>
            )}
            {(localError ?? (replace.isError ? getApiErrorMessage(replace.error) : null)) && (
              <Alert variant="error">{localError ?? getApiErrorMessage(replace.error)}</Alert>
            )}
          </div>
        ) : (
          <p className={styles.hint}>This order can no longer be changed.</p>
        )}
      </li>
    )
  }

  return (
    <li className={styles.row}>
      <p className={styles.rowTitle}>
        {productName} — {photo.fieldLabel}
      </p>
      <p className={styles.status}>
        {photo.reviewStatus === 'APPROVED' ? 'Photo approved' : 'We’re reviewing your photo'}
      </p>
    </li>
  )
}

/**
 * Where the customer sees what happened to the photo they uploaded: under
 * review, approved, or "we need a new one" with the reason and an upload
 * control. Renders nothing when no photo on the order is under review.
 */
export function OrderPhotoStatus({ order }: { order: OrderDetailView }) {
  // Nothing to say about the photo until the order is paid (and nothing once
  // it is cancelled or refunded).
  if (!photoReviewApplies(order.status)) return null
  const photos = order.items.flatMap((item) =>
    item.customizations
      .filter((c) => c.uploadedFileId !== null && Boolean(c.reviewStatus))
      .map((photo) => ({ item, photo })),
  )
  if (photos.length === 0) return null
  const canReplace = order.status === 'PAID' || order.status === 'CONFIRMED'

  return (
    <section aria-label="Your photo">
      <h2 className={styles.heading}>Your photo</h2>
      <ul className={styles.list}>
        {photos.map(({ item, photo }) => (
          <PhotoRow
            key={photo.id}
            orderId={order.id}
            productName={item.productName}
            photo={photo}
            canReplace={canReplace}
          />
        ))}
      </ul>
    </section>
  )
}
