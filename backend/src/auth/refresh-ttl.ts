import { Role } from '../common/enums/role.enum';

/**
 * Shoppers keep a long-lived refresh cookie. Anyone who can reach admin
 * or platform surfaces gets a much shorter one so a shared laptop does
 * not stay authorized for weeks.
 */
export function refreshTtlMsForUser(
  user: { role: string; platformRole: string | null },
  ttls: { customerMs: number; adminMs: number },
): number {
  if (user.role === Role.ADMIN || user.platformRole === 'SUPER_ADMIN') {
    return ttls.adminMs;
  }
  return ttls.customerMs;
}
