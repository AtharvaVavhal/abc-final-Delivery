/**
 * Mirrors backend/src/orders/dto/order-view.interface.ts and the Prisma
 * enums it's built from (schema.prisma) — read-side response shapes for
 * GET /orders and GET /orders/:id only, no request DTOs here.
 */

export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'PAYMENT_FAILED'
  | 'CONFIRMED'
  | 'IN_PRODUCTION'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'REFUNDED'

export type PaymentAttemptStatus = 'INITIATED' | 'CAPTURED' | 'FAILED' | 'ABANDONED'
export type RefundStatus = 'PENDING' | 'PROCESSED' | 'FAILED'

/** Review state of one uploaded photo (null: text-only field, or not under review). */
export type PhotoReviewStatus = 'PENDING' | 'APPROVED' | 'CHANGES_REQUESTED'

/** What an order's photos add up to, in the order the admin must act:
 * anything to review first, then anything waiting on the customer. */
export type PhotoReviewSummary = 'NONE' | 'TO_REVIEW' | 'CHANGES_REQUESTED' | 'APPROVED'

export interface OrderItemCustomizationView {
  id: string
  fieldLabel: string
  textValue: string | null
  uploadedFileId: string | null
  reviewStatus: PhotoReviewStatus | null
  /** The admin's reason when a new photo was requested. */
  reviewNote: string | null
}

export interface OrderItemView {
  id: string
  productId: string | null
  productName: string
  variantLabel: string | null
  unitPrice: string
  quantity: number
  lineTotal: string
  customizations: OrderItemCustomizationView[]
}

export interface RefundView {
  id: string
  amountPaise: string
  status: RefundStatus
  reason: string | null
  createdAt: string
}

export interface PaymentAttemptView {
  id: string
  status: PaymentAttemptStatus
  amountPaise: string
  method: string | null
  failureCode: string | null
  failureReason: string | null
  createdAt: string
  capturedAt: string | null
  refunds: RefundView[]
}

export interface OrderStatusHistoryView {
  fromStatus: OrderStatus | null
  toStatus: OrderStatus
  changedByUserId: string | null
  note: string | null
  createdAt: string
}

export interface OrderListItemView {
  id: string
  orderNumber: string
  status: OrderStatus
  total: string
  currency: string
  /** Who the order is for — the shipping recipient name from checkout. */
  recipientName: string
  photoReview: PhotoReviewSummary
  itemCount: number
  /** True iff a refund is flagged PENDING and awaiting manual processing —
   * §12.5, no in-app refund-initiation in MVP. */
  needsManualRefund: boolean
  createdAt: string
}

/** GET /orders only accepts page/limit/status (ListOrdersQueryDto) — no
 * search/sort param exists server-side; results are always newest-first. */
export interface ListOrdersParams {
  page?: number
  limit?: number
  status?: OrderStatus
}

export interface OrderDetailView extends OrderListItemView {
  subtotal: string
  /** Read from the stored orders.shippingFee column — previously absent
   * from this view entirely (only checkout's own response exposed it). */
  shippingFee: string
  /** Major-unit decimal string, "0.00" when no coupon was applied — never
   * null. */
  discountAmount: string
  /** Tax snapshot (Phase 13.4). "0.00" tax until a client-confirmed GST
   * rate is enabled; total unchanged under tax-inclusive pricing. */
  taxableAmount: string
  taxAmount: string
  taxMode: string
  taxRatePercent: string | null
  /** Denormalized snapshot of the applied coupon's code, null when none
   * was applied — never a live join back to coupons. */
  couponCode: string | null
  shippingRecipientName: string
  shippingPhone: string
  shippingAddressLine1: string
  shippingAddressLine2: string | null
  shippingCity: string
  shippingState: string
  shippingPostalCode: string
  shippingCountry: string
  /** The delivery pin the customer shared, or null. Erased once the order is delivered, cancelled or refunded. */
  deliveryPin: { latitude: number; longitude: number } | null
  items: OrderItemView[]
  statusHistory: OrderStatusHistoryView[]
  paymentAttempts: PaymentAttemptView[]
}
