import { useMutation, useQueryClient } from '@tanstack/react-query'
import { verifyPayment } from '@/services/api/payments'
import type { VerifyPaymentPayload } from '@/types/payments'
import { CART_QUERY_KEY } from './useCart'

export function useVerifyPayment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: VerifyPaymentPayload) => verifyPayment(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CART_QUERY_KEY })
    },
  })
}
