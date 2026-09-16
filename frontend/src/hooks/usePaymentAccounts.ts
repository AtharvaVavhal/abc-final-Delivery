import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  connectPaymentAccount,
  createPaymentAccount,
  fetchPaymentAccounts,
  type PaymentAccountMode,
} from '@/services/api/paymentAccounts'

export const ADMIN_PAYMENT_ACCOUNTS_QUERY_KEY = ['admin', 'payment-accounts'] as const

export function usePaymentAccounts() {
  return useQuery({
    queryKey: ADMIN_PAYMENT_ACCOUNTS_QUERY_KEY,
    queryFn: fetchPaymentAccounts,
  })
}

export function useConnectStoreRazorpay() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      accountId?: string
      mode: PaymentAccountMode
      keyId: string
      keySecret: string
      webhookSecret?: string
    }) => {
      const account =
        payload.accountId !== undefined
          ? { id: payload.accountId }
          : await createPaymentAccount({
              provider: 'RAZORPAY',
              mode: payload.mode,
              displayName: 'AB Creations Razorpay',
            })
      return connectPaymentAccount(account.id, {
        keyId: payload.keyId,
        keySecret: payload.keySecret,
        webhookSecret: payload.webhookSecret,
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ADMIN_PAYMENT_ACCOUNTS_QUERY_KEY })
    },
  })
}
