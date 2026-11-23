import type { OrderStatus } from './orders'

/**
 * Mirrors backend/src/checkout/dto/order-view.interface.ts — the response
 * shape for POST /checkout/orders. Deliberately distinct from
 * OrderDetailView (types/orders.ts): this view has no itemCount,
 * needsManualRefund, statusHistory, or paymentAttempts — those are only
 * assembled by the orders module (GET /orders/:id), not checkout.
 */

export interface CheckoutOrderItemCustomizationView {
  fieldLabel: string
  textValue: string | null
  uploadedFileId: string | null
}

export interface CheckoutOrderItemView {
  id: string
  productId: string | null
  productName: string
  variantLabel: string | null
  unitPrice: string
  quantity: number
  lineTotal: string
  customizations: CheckoutOrderItemCustomizationView[]
}

export interface CheckoutOrderView {
  id: string
  orderNumber: string
  status: OrderStatus
  subtotal: string
  shippingFee: string
  total: string
  /** Major-unit decimal string, "0.00" when no coupon was applied — never
   * null, mirrors the stored orders.discountAmount column's own
   * never-null default. */
  discountAmount: string
  /** Tax snapshot (Phase 13.4). `taxAmount` is "0.00" until a
   * client-confirmed GST rate is enabled; with tax-inclusive pricing the
   * customer total is unchanged. `taxRatePercent` is the human-readable
   * rate (e.g. "18.00") or null. */
  taxableAmount: string
  taxAmount: string
  taxMode: string
  taxRatePercent: string | null
  /** Denormalized snapshot of the applied coupon's code, null when none
   * was applied. */
  couponCode: string | null
  currency: string
  shippingRecipientName: string
  shippingPhone: string
  shippingAddressLine1: string
  shippingAddressLine2: string | null
  shippingCity: string
  shippingState: string
  shippingPostalCode: string
  shippingCountry: string
  items: CheckoutOrderItemView[]
  createdAt: string
}

/** Matches CreateOrderDto's fields exactly (backend/src/checkout/dto/create-order.dto.ts). */
export interface CreateOrderPayload {
  shippingRecipientName: string
  shippingPhone: string
  shippingAddressLine1: string
  shippingAddressLine2?: string
  shippingCity: string
  shippingState: string
  shippingPostalCode: string
  shippingCountry: string
  /** Optional delivery pin the customer chose to share (both or neither). */
  shippingLatitude?: number
  shippingLongitude?: number
  /** Optional — checked and claimed inside the same transaction as order
   * creation, never a separate pre-check. Should be the server's own
   * normalized echo from a prior POST /checkout/validate call (see
   * CheckoutPreviewView.couponCode in types/coupons.ts), not raw user
   * input — but the real checkout re-validates it regardless. */
  couponCode?: string
}
