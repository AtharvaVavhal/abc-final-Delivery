import {
  OrderStatus,
  PaymentAttemptStatus,
  PhotoReviewStatus,
  RefundStatus,
} from '@prisma/client';
import type { PhotoReviewSummary } from '../photo-review.util';

/**
 * Read-side response shapes — not request DTOs. Money fields are
 * major-unit decimal strings (§21); paise/bigint math never crosses the
 * HTTP boundary. Everything here is a snapshot read back from
 * Order/OrderItem/OrderItemCustomization rows — never live-recomputed
 * from current catalog state (that's Cart's job, not Orders' — §13.G).
 * `paymentAttempts[]` is nested here per §20 ("payment_attempts is never
 * exposed as a standalone endpoint... surfaced only as a nested array
 * inside GET /orders/:id and GET /admin/orders/:id").
 */

export interface OrderItemCustomizationView {
  id: string;
  fieldLabel: string;
  textValue: string | null;
  uploadedFileId: string | null;
  /** Photo review state; null for text-only fields and for orders whose
   * photo is not under review (unpaid/cancelled/refunded). */
  reviewStatus: PhotoReviewStatus | null;
  /** The admin's reason when changes were requested. */
  reviewNote: string | null;
}

export interface OrderItemView {
  id: string;
  productId: string | null;
  productName: string;
  variantLabel: string | null;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
  customizations: OrderItemCustomizationView[];
}

export interface RefundView {
  id: string;
  amountPaise: string;
  status: RefundStatus;
  reason: string | null;
  createdAt: Date;
}

export interface PaymentAttemptView {
  id: string;
  status: PaymentAttemptStatus;
  amountPaise: string;
  method: string | null;
  failureCode: string | null;
  failureReason: string | null;
  createdAt: Date;
  capturedAt: Date | null;
  refunds: RefundView[];
}

export interface OrderStatusHistoryView {
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  changedByUserId: string | null;
  note: string | null;
  createdAt: Date;
}

export interface OrderListItemView {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  total: string;
  currency: string;
  itemCount: number;
  /** True iff a Refund row (status PENDING, no razorpayRefundId — the
   * in-app trigger was deliberately removed, §12.5) is waiting on ops to
   * action manually via the Razorpay dashboard. Surfaced here so it's
   * visible directly in the admin order list, not just on drill-in. */
  needsManualRefund: boolean;
  /** Who the order is for: the shipping recipient name captured at checkout
   * (the immutable snapshot, §11), so the admin list can show a person and
   * not just an order number. */
  recipientName: string;
  /** What this order's photos add up to — see summarisePhotoReview. */
  photoReview: PhotoReviewSummary;
  createdAt: Date;
}

export interface OrderDetailView extends OrderListItemView {
  subtotal: string;
  /** Read from the stored orders.shippingFee column — see
   * checkout/dto/order-view.interface.ts's OrderView.shippingFee for why
   * this was never safe to derive as `total - subtotal` once discount
   * could be nonzero (PHASE-10-PROPOSAL.md §2.5). Previously absent from
   * this view entirely (only checkout's own response exposed it) — added
   * alongside the coupon fields below as a small, free consistency fix. */
  shippingFee: string;
  /** Major-unit decimal string, "0.00" when no coupon was applied — never
   * null (§2.1/C7). */
  discountAmount: string;
  /** Tax snapshot (Phase 13.4). "0.00" tax until a client-confirmed GST
   * rate is enabled; `total` is unchanged under tax-INCLUSIVE pricing. */
  taxableAmount: string;
  taxAmount: string;
  taxMode: string;
  taxRatePercent: string | null;
  /** Denormalized snapshot of the applied coupon's code, null when none
   * was applied — never a live join back to `coupons`. */
  couponCode: string | null;
  shippingRecipientName: string;
  shippingPhone: string;
  shippingAddressLine1: string;
  shippingAddressLine2: string | null;
  shippingCity: string;
  shippingState: string;
  shippingPostalCode: string;
  shippingCountry: string;
  items: OrderItemView[];
  statusHistory: OrderStatusHistoryView[];
  paymentAttempts: PaymentAttemptView[];
}
