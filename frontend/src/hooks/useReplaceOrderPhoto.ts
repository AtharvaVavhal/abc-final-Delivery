import { useMutation, useQueryClient } from '@tanstack/react-query'
import { replaceOrderPhoto } from '@/services/api/orders'
import { uploadFile } from '@/services/api/uploads'
import { orderQueryKey } from './useOrder'

/** Upload the new photo, then attach it to the order's photo field. Two
 * calls, one action for the customer; either failing surfaces as the
 * mutation's error. On success the order refetches and shows "under review". */
export function useReplaceOrderPhoto(orderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { customizationId: string; file: File }) => {
      const uploaded = await uploadFile(vars.file)
      return replaceOrderPhoto(orderId, vars.customizationId, uploaded.id)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orderQueryKey(orderId) })
    },
  })
}
