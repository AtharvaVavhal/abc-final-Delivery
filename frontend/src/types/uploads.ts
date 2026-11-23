/**
 * Mirrors backend/src/uploads/uploads.controller.ts's UploadedFileView —
 * the response shape of POST /uploads and GET /uploads/:id.
 */
export interface UploadedFile {
  id: string
  url: string
  format: string
  bytes: number
  /** Pixel size for images; null for older files. */
  width: number | null
  height: number | null
  createdAt: string
}
