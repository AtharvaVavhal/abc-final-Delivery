import { useQuery } from '@tanstack/react-query'
import { fetchUploadedFile } from '@/services/api/uploads'

/** Metadata + signed URL for an uploaded file. The URL is short-lived, so
 * it is not cached for long. */
export function useUploadedFile(fileId: string | null) {
  return useQuery({
    queryKey: ['uploads', fileId],
    queryFn: ({ signal }) => fetchUploadedFile(fileId!, signal),
    enabled: fileId !== null,
    staleTime: 60_000,
    retry: false,
  })
}
