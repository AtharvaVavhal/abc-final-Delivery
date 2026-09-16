import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createOrder } from '@/services/api/checkout'
import type { CreateOrderPayload } from '@/types/checkout'
import { CART_QUERY_KEY } from './useCart'
import { UNPAID_CHECKOUT_ORDER_QUERY_KEY } from './useOrders'

export function useCreateOrder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ payload, idempotencyKey }: { payload: CreateOrderPayload; idempotencyKey: string }) =>
      createOrder(payload, idempotencyKey),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CART_QUERY_KEY })
      void queryClient.invalidateQueries({ queryKey: UNPAID_CHECKOUT_ORDER_QUERY_KEY })
    },
  })
}
