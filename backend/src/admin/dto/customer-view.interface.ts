import { Role } from '@prisma/client';
import { OrderListItemView } from '../../orders/dto/order-view.interface';

/**
 * Read-only admin views (§19: "customer list (read-only)" — no PATCH).
 * Same safe-field discipline as UsersService.toProfileView — assembled
 * field-by-field, never `{...user}`, so passwordHash, tokenVersion,
 * failedLoginAttempts, passwordResetTokenHash, passwordResetExpiresAt can
 * never leak here either. Unlike GET /users/me, `isActive` IS included —
 * it's useful admin context and a documented filter on the list endpoint,
 * not a self-service concern.
 */
export interface AdminCustomerListItemView {
  id: string;
  email: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  phone: string | null;
  role: Role;
  isActive: boolean;
  createdAt: Date;
  /** All orders regardless of status — cheap via a `_count` join, so it
   * rides along on the list query too (see AdminService.listCustomers). */
  orderCount: number;
}

export interface AdminCustomerDetailView extends AdminCustomerListItemView {
  /** Major-unit decimal string (§21) — sum of paid-or-later order totals,
   * same revenue definition as the dashboard. Left off the list view: it
   * needs its own filtered aggregation query per page, not worth paying
   * for on every row of a browsing list. */
  totalSpend: string;
  recentOrders: OrderListItemView[];
}
