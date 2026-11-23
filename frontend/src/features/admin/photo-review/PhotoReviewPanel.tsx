import { useState } from 'react'
import type { FormEvent } from 'react'
import { useReviewOrderPhoto } from '@/hooks/useReviewOrderPhoto'
import { useUploadedFile } from '@/hooks/useUploadedFile'
import { getApiErrorMessage } from '@/utils/apiError'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { AdminCard } from '@/components/admin/AdminCard'
import type { OrderDetailView, OrderItemCustomizationView, OrderItemView } from '@/types/orders'
import { PhotoPill } from './PhotoPill'
import { canReviewPhotos, formatBytes } from './photoReviewLabels'
import styles from './PhotoReview.module.css'

const NOTE_MIN = 3
const NOTE_MAX = 500

interface PhotoCardProps {
  orderId: string
  item: OrderItemView
  photo: OrderItemCustomizationView
  reviewable: boolean
}

function PhotoCard({ orderId, item, photo, reviewable }: PhotoCardProps) {
  const file = useUploadedFile(photo.uploadedFileId)
  const review = useReviewOrderPhoto(orderId)
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState('')
  const trimmed = note.trim()
  const noteValid = trimmed.length >= NOTE_MIN && trimmed.length <= NOTE_MAX
  const instructions = item.customizations.filter((c) => c.textValue)
  const approved = photo.reviewStatus === 'APPROVED'

  function approve() {
    review.mutate({ customizationId: photo.id, decision: 'APPROVE' })
  }

  function submitRequest(event: FormEvent) {
    event.preventDefault()
    if (!noteValid) return
    review.mutate(
      { customizationId: photo.id, decision: 'REQUEST_CHANGES', note: trimmed },
      {
        onSuccess: () => {
          setAsking(false)
          setNote('')
        },
      },
    )
  }

  const noteId = `photo-note-${photo.id}`
  const status = photo.reviewStatus

  return (
    <article className={styles.card} aria-label={`${item.productName}, ${photo.fieldLabel}`}>
      <div className={styles.preview}>
        {file.isPending ? (
          <span className={styles.previewNote}>Loading photo…</span>
        ) : file.isError || !file.data ? (
          <span className={styles.previewNote}>The photo couldn’t be loaded.</span>
        ) : (
          <a href={file.data.url} target="_blank" rel="noreferrer" className={styles.previewLink}>
            <img
              src={file.data.url}
              alt={`Customer photo for ${item.productName}: ${photo.fieldLabel}`}
              className={styles.image}
            />
          </a>
        )}
      </div>

      <div className={styles.details}>
        <div className={styles.headRow}>
          <div className={styles.titles}>
            <h3 className={styles.title}>{item.productName}</h3>
            <span className={styles.sub}>{photo.fieldLabel}</span>
          </div>
          {status ? (
            <PhotoPill
              summary={
                status === 'PENDING' ? 'TO_REVIEW' : status === 'APPROVED' ? 'APPROVED' : 'CHANGES_REQUESTED'
              }
            />
          ) : (
            <span className={styles.none}>Not under review</span>
          )}
        </div>

        {file.data && (
          <dl className={styles.facts}>
            <div>
              <dt>Format</dt>
              <dd>{file.data.format.toUpperCase()}</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>{formatBytes(file.data.bytes)}</dd>
            </div>
            <div>
              <dt>Resolution</dt>
              <dd>
                {file.data.width && file.data.height ? `${file.data.width} × ${file.data.height} px` : 'Not recorded'}
              </dd>
            </div>
          </dl>
        )}

        {instructions.length > 0 && (
          <div className={styles.instructions}>
            <span className={styles.label}>Customer instructions</span>
            {instructions.map((c) => (
              <p key={c.id} className={styles.instruction}>
                <span className={styles.sub}>{c.fieldLabel}:</span> {c.textValue}
              </p>
            ))}
          </div>
        )}

        {status === 'CHANGES_REQUESTED' && photo.reviewNote && (
          <p className={styles.noteShown}>
            <span className={styles.label}>You asked for a new photo:</span> {photo.reviewNote}
          </p>
        )}

        {review.isError && <Alert variant="error">{getApiErrorMessage(review.error)}</Alert>}

        {reviewable && status && (
          <div className={styles.actions}>
            {asking ? (
              <form className={styles.askForm} onSubmit={submitRequest}>
                <label htmlFor={noteId} className={styles.label}>
                  What should the customer fix?
                </label>
                <textarea
                  id={noteId}
                  className={styles.textarea}
                  rows={3}
                  maxLength={NOTE_MAX}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. The photo is too dark — please upload a brighter one."
                  aria-describedby={`${noteId}-hint`}
                />
                <span id={`${noteId}-hint`} className={styles.hint}>
                  Shown to the customer. {NOTE_MIN}–{NOTE_MAX} characters.
                </span>
                <div className={styles.buttons}>
                  <Button type="submit" disabled={!noteValid} isLoading={review.isPending}>
                    Send request
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setAsking(false)}
                    disabled={review.isPending}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <div className={styles.buttons}>
                <Button type="button" onClick={approve} disabled={approved} isLoading={review.isPending}>
                  {approved ? 'Approved' : 'Approve for production'}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setAsking(true)}
                  disabled={review.isPending}
                >
                  Ask for a new photo
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  )
}

/**
 * The photos a customer uploaded with this order, each with a large preview,
 * the facts about the file, the customer's text instructions, and the two
 * decisions an admin can make. Decisions are only offered while the order
 * is paid and not yet in production (the backend enforces the same rule).
 * Renders nothing for an order with no photos.
 */
export function PhotoReviewPanel({ order }: { order: OrderDetailView }) {
  const photos = order.items.flatMap((item) =>
    item.customizations.filter((c) => c.uploadedFileId !== null).map((photo) => ({ item, photo })),
  )
  if (photos.length === 0) return null
  const reviewable = canReviewPhotos(order.status)

  return (
    <AdminCard as="section" title="Customer photos">
      {!reviewable && (
        <p className={styles.closed}>
          Photos can be reviewed while the order is paid and not yet in production.
        </p>
      )}
      <div className={styles.list}>
        {photos.map(({ item, photo }) => (
          <PhotoCard key={photo.id} orderId={order.id} item={item} photo={photo} reviewable={reviewable} />
        ))}
      </div>
    </AdminCard>
  )
}
