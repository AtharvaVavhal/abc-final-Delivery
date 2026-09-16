import type { ApiSuccessResponse, PaginationMeta } from '@/types/api'
import { apiClient } from './client'

export type PaymentAccountStatus = 'PENDING' | 'ACTIVE' | 'DISABLED'
export type PaymentAccountMode = 'TEST' | 'LIVE'
export type PaymentProviderType = 'RAZORPAY'

export interface PaymentAccountView {
  id: string
  storeId: string
  provider: PaymentProviderType
  status: PaymentAccountStatus
  mode: PaymentAccountMode
  displayName: string | null
  connectedAt: string | null
  disabledAt: string | null
  disabledReason: string | null
  createdAt: string
  updatedAt: string
}

export async function fetchPaymentAccounts(): Promise<{
  items: PaymentAccountView[]
  meta: PaginationMeta
}> {
  const res = await apiClient.get<ApiSuccessResponse<PaymentAccountView[]>>(
    '/admin/payment-accounts',
  )
  return { items: res.data.data, meta: res.data.meta as PaginationMeta }
}

export async function createPaymentAccount(payload: {
  provider: PaymentProviderType
  mode: PaymentAccountMode
  displayName?: string
}): Promise<PaymentAccountView> {
  const res = await apiClient.post<ApiSuccessResponse<PaymentAccountView>>(
    '/admin/payment-accounts',
    payload,
  )
  return res.data.data
}

export async function connectPaymentAccount(
  id: string,
  payload: { keyId: string; keySecret: string; webhookSecret?: string },
): Promise<PaymentAccountView> {
  const res = await apiClient.post<ApiSuccessResponse<PaymentAccountView>>(
    `/admin/payment-accounts/${id}/connect`,
    payload,
  )
  return res.data.data
}
