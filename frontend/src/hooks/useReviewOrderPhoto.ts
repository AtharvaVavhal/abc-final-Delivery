import { useMutation, useQueryClient } from '@tanstack/react-query'
import { reviewOrderPhoto } from '@/services/api/admin'
import type { ReviewPhotoPayload } from '@/types/admin'
import { adminOrderQueryKey } from './useAdminOrder'
import { ADMIN_DASHBOARD_QUERY_KEY } from './useAdminDashboard'

/** Approve a photo or ask for a new one. A decision changes this order's
 * photo state, the orders list (pill / "Photo review" tab) and the
 * dashboard's "photos awaiting review" count, so all three refetch. */
export function useReviewOrderPhoto(orderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { customizationId: string } & ReviewPhotoPayload) => {
      const { customizationId, ...payload } = vars
      return reviewOrderPhoto(orderId, customizationId, payload)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminOrderQueryKey(orderId) })
      void queryClient.invalidateQueries({ queryKey: ['admin', 'orders', 'list'] })
      void queryClient.invalidateQueries({ queryKey: ADMIN_DASHBOARD_QUERY_KEY })
    },
  })
}
