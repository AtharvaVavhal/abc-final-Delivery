import { OrderStatus } from '@prisma/client';
import { OrderListItemView } from '../../orders/dto/order-view.interface';

/** GET /admin/dashboard (§19) — "minimal, no charts": order count/revenue/
 * recent orders. Nothing time-bucketed or chart-shaped. */
export interface OrderStatusCount {
  status: OrderStatus;
  count: number;
}

export interface AdminDashboardView {
  totalOrders: number;
  /** Photos on paid, not-yet-in-production orders still waiting for an
   * approve / ask-for-a-new-one decision. */
  photosAwaitingReview: number;
  /** Every OrderStatus value, zero-filled — not just the statuses that
   * currently have orders — so the frontend never has to fill gaps. */
  ordersByStatus: OrderStatusCount[];
  /** Major-unit decimal string (§21). Sum of PAID/CONFIRMED/IN_PRODUCTION/
   * SHIPPED/DELIVERED order totals — "paid-or-later," excluding
   * PENDING_PAYMENT/PAYMENT_FAILED (never paid) and CANCELLED/REFUNDED
   * (money not kept). */
  totalRevenue: string;
  /** Last 10, newest first — same shape as a GET /admin/orders list row. */
  recentOrders: OrderListItemView[];
}
