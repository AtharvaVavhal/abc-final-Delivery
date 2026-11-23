import type { ApiSuccessResponse, PaginationMeta } from '@/types/api'
import type { OrderDetailView, OrderListItemView } from '@/types/orders'
import type {
  AdminCustomerDetailView,
  AdminCustomerListItemView,
  AdminDashboardOverviewView,
  AdminDashboardView,
  ListAdminCustomersParams,
  ListAdminOrdersParams,
  ReviewPhotoPayload,
  ReviewPhotoResult,
  UpdateOrderStatusPayload,
  UpdateReviewStatusPayload,
} from '@/types/admin'
import type { ReviewView } from '@/types/reviews'
import { apiClient } from './client'

/**
 * Thin wrappers over backend/src/admin/admin.controller.ts. Every request
 * here needs an ADMIN-role JWT server-side (RolesGuard, class-wide
 * @Roles(Role.ADMIN)) — confirmed live that a non-admin gets a 403 with
 * {code:"FORBIDDEN", message:"Insufficient role for this resource"} and an
 * unauthenticated request gets 401, same envelope shape as everywhere else.
 */

export async function fetchAdminDashboard(): Promise<AdminDashboardView> {
  const res = await apiClient.get<ApiSuccessResponse<AdminDashboardView>>('/admin/dashboard')
  return res.data.data
}

/** GET /admin/dashboard/overview — daily sales for the chart/KPI tiles and
 * the equal period before it, for the comparison. */
export async function fetchAdminDashboardOverview(
  days: number,
): Promise<AdminDashboardOverviewView> {
  const res = await apiClient.get<ApiSuccessResponse<AdminDashboardOverviewView>>(
    '/admin/dashboard/overview',
    { params: { days } },
  )
  return res.data.data
}

export interface AdminOrderListResult {
  items: OrderListItemView[]
  meta: PaginationMeta
}

/** GET /admin/orders — confirmed live to be paginated identically to GET
 * /orders (same {data, meta:{page,limit,total,totalPages}} envelope,
 * newest-first), just with admin-only filters (status/userId/dateFrom/
 * dateTo) and no ownership scoping. */
export async function fetchAdminOrders(params: ListAdminOrdersParams = {}): Promise<AdminOrderListResult> {
  const res = await apiClient.get<ApiSuccessResponse<OrderListItemView[]>>('/admin/orders', { params })
  return { items: res.data.data, meta: res.data.meta as PaginationMeta }
}

/** GET /admin/orders/:id — confirmed live to return exactly the same
 * OrderDetailView shape as the customer-facing GET /orders/:id (no extra
 * admin-only fields — needsManualRefund is already part of the shared
 * shape, not something added here). */
export async function fetchAdminOrder(orderId: string): Promise<OrderDetailView> {
  const res = await apiClient.get<ApiSuccessResponse<OrderDetailView>>(`/admin/orders/${orderId}`)
  return res.data.data
}

/**
 * PATCH /admin/orders/:id/status — submits the requested status as-is;
 * the backend's state machine (order-state-machine.ts) is the only place
 * that decides whether a transition is legal, confirmed live: an illegal
 * transition (e.g. PENDING_PAYMENT -> DELIVERED) responds 409 CONFLICT
 * with `"Illegal order transition: X -> Y"`, an already-applied one is a
 * no-op 200, and a target of REFUNDED also flips any PENDING Refund row
 * on the order to PROCESSED server-side — the returned OrderDetailView's
 * `needsManualRefund` already reflects that, no separate UI step needed.
 */
export async function updateAdminOrderStatus(
  orderId: string,
  payload: UpdateOrderStatusPayload,
): Promise<OrderDetailView> {
  const res = await apiClient.patch<ApiSuccessResponse<OrderDetailView>>(`/admin/orders/${orderId}/status`, payload)
  return res.data.data
}

/** PATCH /admin/orders/:id/customizations/:cid/review — approve a customer's
 * photo or ask for a new one (note required for the latter). Only valid
 * while the order is paid and not yet in production; the backend enforces it. */
export async function reviewOrderPhoto(
  orderId: string,
  customizationId: string,
  payload: ReviewPhotoPayload,
): Promise<ReviewPhotoResult> {
  const res = await apiClient.patch<ApiSuccessResponse<ReviewPhotoResult>>(
    `/admin/orders/${orderId}/customizations/${customizationId}/review`,
    payload,
  )
  return res.data.data
}

export interface AdminCustomerListResult {
  items: AdminCustomerListItemView[]
  meta: PaginationMeta
}

export async function fetchAdminCustomers(
  params: ListAdminCustomersParams = {},
): Promise<AdminCustomerListResult> {
  const res = await apiClient.get<ApiSuccessResponse<AdminCustomerListItemView[]>>('/admin/customers', { params })
  return { items: res.data.data, meta: res.data.meta as PaginationMeta }
}

export async function fetchAdminCustomer(customerId: string): Promise<AdminCustomerDetailView> {
  const res = await apiClient.get<ApiSuccessResponse<AdminCustomerDetailView>>(`/admin/customers/${customerId}`)
  return res.data.data
}

/** PATCH /admin/reviews/:id/status — any ReviewStatus to any ReviewStatus
 * is a valid moderation action (no legality graph, unlike order status).
 * There is no GET /admin/reviews (list-all) endpoint — this is the only
 * review-moderation route that exists; see
 * features/admin/ProductReviewModeration.tsx for how a review id is found
 * to moderate without one. */
export async function updateReviewStatus(
  reviewId: string,
  payload: UpdateReviewStatusPayload,
): Promise<ReviewView> {
  const res = await apiClient.patch<ApiSuccessResponse<ReviewView>>(
    `/admin/reviews/${reviewId}/status`,
    payload,
  )
  return res.data.data
}
