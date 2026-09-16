import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createOrder } from '@/services/api/checkout'
import type { CreateOrderPayload } from '@/types/checkout'
import { CART_QUERY_KEY } from './useCart'

export function useCreateOrder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ payload, idempotencyKey }: { payload: CreateOrderPayload; idempotencyKey: string }) =>
      createOrder(payload, idempotencyKey),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CART_QUERY_KEY })
    },
  })
}
