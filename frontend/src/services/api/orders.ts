import type { ApiSuccessResponse, PaginationMeta } from '@/types/api'
import type { ListOrdersParams, OrderDetailView, OrderListItemView } from '@/types/orders'
import { apiClient } from './client'

/** Thin wrappers over backend/src/orders/orders.controller.ts. */

export interface OrderListResult {
  items: OrderListItemView[]
  meta: PaginationMeta
}

/** GET /orders — confirmed live (curl) to be paginated identically to
 * GET /products: {data: OrderListItemView[], meta: {page, limit, total,
 * totalPages}}, already sorted newest-first server-side (orderBy
 * createdAt desc, orders.service.ts). Same unwrap pattern as
 * catalog.ts's fetchProducts. */
export async function fetchOrders(params: ListOrdersParams = {}): Promise<OrderListResult> {
  const res = await apiClient.get<ApiSuccessResponse<OrderListItemView[]>>('/orders', { params })
  return { items: res.data.data, meta: res.data.meta as PaginationMeta }
}

export async function fetchOrder(orderId: string): Promise<OrderDetailView> {
  const res = await apiClient.get<ApiSuccessResponse<OrderDetailView>>(`/orders/${orderId}`)
  return res.data.data
}

/** POST /orders/:id/cancel — customer-initiated cancellation, allowed only
 * from PAID/CONFIRMED (orders.service.ts's state machine); a 409 from an
 * illegal-transition attempt surfaces via getApiErrorMessage like any
 * other mutation error. */
export async function cancelOrder(orderId: string, reason?: string): Promise<OrderDetailView> {
  const res = await apiClient.post<ApiSuccessResponse<OrderDetailView>>(
    `/orders/${orderId}/cancel`,
    reason ? { reason } : undefined,
  )
  return res.data.data
}
