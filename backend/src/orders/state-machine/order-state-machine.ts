import { OrderStatus } from '@prisma/client';

/**
 * Order.status compare-and-swap transition table — BLUEPRINT-v1.2.md §14.
 * A transition not listed here must be rejected (409 INVALID_TRANSITION),
 * not silently allowed. Every transition is applied as
 * `UPDATE orders SET status=$to WHERE id=$id AND status IN ($allowed_from)`
 * — rows-affected=1 fires side effects (history row, outbox event);
 * rows-affected=0 is re-read: already $to is an idempotent 200 (admin
 * double-click safe), otherwise 409.
 *
 * Kept as a pure, side-effect-free lookup so it can be unit tested without
 * a database.
 */
export const ORDER_STATE_TRANSITIONS: Readonly<
  Record<OrderStatus, readonly OrderStatus[]>
> = {
  PENDING_PAYMENT: ['PAID', 'PAYMENT_FAILED', 'CANCELLED'],
  PAYMENT_FAILED: ['PENDING_PAYMENT', 'CANCELLED'],
  PAID: ['CANCELLED', 'CONFIRMED', 'REFUNDED'],
  CONFIRMED: ['CANCELLED', 'IN_PRODUCTION', 'REFUNDED'],
  IN_PRODUCTION: ['SHIPPED', 'REFUNDED'],
  SHIPPED: ['DELIVERED', 'REFUNDED'],
  DELIVERED: ['REFUNDED'],
  CANCELLED: ['REFUNDED'],
  REFUNDED: [],
};

export function isTransitionAllowed(
  from: OrderStatus,
  to: OrderStatus,
): boolean {
  return ORDER_STATE_TRANSITIONS[from].includes(to);
}
