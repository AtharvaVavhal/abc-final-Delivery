import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createOrder } from '@/services/api/checkout'
import type { CreateOrderPayload } from '@/types/checkout'
import { UNPAID_CHECKOUT_ORDER_QUERY_KEY } from './useOrders'

export function useCreateOrder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ payload, idempotencyKey }: { payload: CreateOrderPayload; idempotencyKey: string }) =>
      createOrder(payload, idempotencyKey),
    onSuccess: () => {
      // Cart lines stay until payment is captured — do not refetch/clear
      // them here or checkout can resume the unpaid order against a stale
      // bag while a newly added product is still in flight.
      void queryClient.invalidateQueries({ queryKey: UNPAID_CHECKOUT_ORDER_QUERY_KEY })
    },
  })
}
