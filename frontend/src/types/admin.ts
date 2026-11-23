/**
 * Mirrors backend/src/admin/dto/*.interface.ts and admin.controller.ts's
 * query DTOs — response/request shapes for GET /admin/dashboard, GET/PATCH
 * /admin/orders[/:id][/status], GET /admin/customers[/:id]. All confirmed
 * live (curl, real ADMIN JWT) rather than assumed from the DTO source.
 *
 * Order shapes (`OrderListItemView`/`OrderDetailView`) are imported from
 * types/orders.ts, not redefined here — confirmed live that GET
 * /admin/orders[/:id] returns exactly that same shape (needsManualRefund
 * included, same as the customer-facing endpoint) with no admin-only
 * fields layered on top.
 */
import type { OrderListItemView, OrderStatus, PhotoReviewStatus, PhotoReviewSummary } from './orders'
import type { CustomizationFieldType, SurchargeType } from './catalog'
import type { ReviewStatus } from './reviews'

export interface OrderStatusCount {
  status: OrderStatus
  count: number
}

export interface AdminDashboardView {
  totalOrders: number
  /** Photos on paid, not-yet-in-production orders awaiting a decision. */
  photosAwaitingReview: number
  /** Every OrderStatus value, zero-filled — confirmed live. */
  ordersByStatus: OrderStatusCount[]
  /** Major-unit decimal string. "Paid-or-later" order totals only. */
  totalRevenue: string
  /** Last 10, newest first. */
  recentOrders: OrderListItemView[]
}

/** GET /admin/orders/GET /admin/orders/:id accept only page/limit/status/
 * userId/dateFrom/dateTo (ListAdminOrdersQueryDto) — no free-text search. */
export interface ListAdminOrdersParams {
  page?: number
  limit?: number
  status?: OrderStatus
  userId?: string
  dateFrom?: string
  dateTo?: string
  photoReview?: PhotoReviewSummary
}

export interface ReviewPhotoPayload {
  decision: 'APPROVE' | 'REQUEST_CHANGES'
  /** Required (3–500 chars) for REQUEST_CHANGES; shown to the customer. */
  note?: string
}

export interface ReviewPhotoResult {
  id: string
  reviewStatus: PhotoReviewStatus
  reviewNote: string | null
  reviewedAt: string
}

export interface UpdateOrderStatusPayload {
  status: OrderStatus
  reason?: string
}

/** GET /admin/customers accepts page/limit/search (email substring, case
 * insensitive)/isActive — ListAdminCustomersQueryDto. */
export interface ListAdminCustomersParams {
  page?: number
  limit?: number
  search?: string
  isActive?: boolean
}

export interface AdminCustomerListItemView {
  id: string
  email: string
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  country: string | null
  phone: string | null
  role: string
  isActive: boolean
  createdAt: string
  /** All orders regardless of status. */
  orderCount: number
}

export interface AdminCustomerDetailView extends AdminCustomerListItemView {
  /** Major-unit decimal string — sum of paid-or-later order totals. */
  totalSpend: string
  recentOrders: OrderListItemView[]
}

/**
 * Catalog admin-write payloads — mirror backend/src/products/dto/*.ts
 * exactly (confirmed against the actual DTO source, not the "name,
 * description, basePrice..." shorthand from the phase brief: there is no
 * `description` field on Product, per types/catalog.ts's own note, and
 * `isActive` is never PATCHable — only DELETE /products/:id flips it, and
 * there is no reactivate endpoint at all).
 */
export interface CreateProductPayload {
  categoryId: string
  name: string
  slug: string
  basePrice: number
  minQuantity: number
  maxQuantity?: number
  specifications?: Record<string, unknown>
}

/** Deliberately excludes `isActive` — same reason UpdateProductDto does. */
export type UpdateProductPayload = Partial<CreateProductPayload>

export interface CreateVariantPayload {
  label: string
  priceDelta?: number
  isAvailable?: boolean
}

export type UpdateVariantPayload = Partial<CreateVariantPayload>

export interface CreateCustomizationFieldPayload {
  label: string
  type: CustomizationFieldType
  isRequired?: boolean
  sortOrder?: number
  helpText?: string
  constraints?: Record<string, unknown>
  surchargeType?: SurchargeType
  surchargeAmount?: number
}

export type UpdateCustomizationFieldPayload = Partial<CreateCustomizationFieldPayload>

/** POST /products/:id/images references an existing POST /uploads result
 * — never a raw file body on this endpoint. */
export interface CreateProductImagePayload {
  uploadedFileId: string
  sortOrder?: number
  isPrimary?: boolean
}

export interface CreateCategoryPayload {
  name: string
  slug: string
  parentCategoryId?: string
}

export type UpdateCategoryPayload = Partial<CreateCategoryPayload>

/** PATCH /admin/reviews/:id/status — the only field. Unlike order status
 * there's no legality graph (reviews.service.ts): any ReviewStatus to any
 * ReviewStatus is a valid moderation action. */
export interface UpdateReviewStatusPayload {
  status: ReviewStatus
}

/** GET /admin/dashboard/overview — mirrors backend
 * src/admin/dto/dashboard-overview.interface.ts. Money is a decimal string. */
export interface DashboardDayPoint {
  /** India calendar day, `YYYY-MM-DD`. */
  date: string
  sales: string
  orders: number
}

export interface DashboardPeriodSummary {
  netSales: string
  orders: number
  averageOrderValue: string
  buyers: number
  repeatBuyers: number
  /** 0–1, or null when there were no buyers. */
  repeatCustomerRate: number | null
  /** Zero-filled, oldest first. */
  daily: DashboardDayPoint[]
}

export interface AdminDashboardOverviewView {
  days: number
  currency: 'INR'
  timezone: 'Asia/Kolkata'
  current: DashboardPeriodSummary
  previous: DashboardPeriodSummary
}

export type OverviewDays = 7 | 30 | 90
