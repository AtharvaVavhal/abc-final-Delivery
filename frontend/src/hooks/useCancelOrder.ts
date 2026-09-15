import { useMutation, useQueryClient } from '@tanstack/react-query'
import { cancelOrder } from '@/services/api/orders'
import { orderQueryKey } from './useOrder'

/** Invalidates both the order detail (orderQueryKey) and the My Orders
 * list (['orders', 'list', ...]) — both keys share the ['orders'] prefix,
 * so one broad invalidate covers whichever of the two is mounted. */
export function useCancelOrder(orderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (reason?: string) => cancelOrder(orderId, reason),
    onSuccess: (updated) => {
      queryClient.setQueryData(orderQueryKey(orderId), updated)
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
  })
}
