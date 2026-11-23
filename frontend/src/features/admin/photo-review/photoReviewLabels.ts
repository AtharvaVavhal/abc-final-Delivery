import type { PhotoReviewStatus, PhotoReviewSummary } from '@/types/orders'

export const PHOTO_STATUS_LABELS: Record<PhotoReviewStatus, string> = {
  PENDING: 'To review',
  APPROVED: 'Approved',
  CHANGES_REQUESTED: 'New photo needed',
}

export const PHOTO_SUMMARY_LABELS: Record<Exclude<PhotoReviewSummary, 'NONE'>, string> = {
  TO_REVIEW: 'To review',
  CHANGES_REQUESTED: 'New photo needed',
  APPROVED: 'Approved',
}

/** Same dot colours as the status pills elsewhere in the admin. */
export const PHOTO_DOT: Record<Exclude<PhotoReviewSummary, 'NONE'>, string> = {
  TO_REVIEW: 'var(--admin-mark, #e8a317)',
  CHANGES_REQUESTED: '#d4402f',
  APPROVED: '#1f9d61',
}

/** A review decision can only be made while the order is paid and not yet in
 * production — the backend enforces the same rule. */
export function canReviewPhotos(orderStatus: string): boolean {
  return orderStatus === 'PAID' || orderStatus === 'CONFIRMED'
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
