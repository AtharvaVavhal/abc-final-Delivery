import type { MembershipStatus, TenantRole } from '@prisma/client';

/**
 * GET /admin/team / POST /admin/team/invite / PATCH .../role /
 * POST .../suspend response shape (Phase 5 W7). Assembled field-by-field
 * from `TenantMembership` + the target `User`'s `id`/`email` only — never
 * a spread of either record, so there is no path for a password hash,
 * password-reset token hash, refresh-token hash, or any other sensitive
 * `User` column to leak here.
 */
export interface TeamMemberView {
  id: string;
  userId: string;
  email: string | null;
  role: TenantRole;
  status: MembershipStatus;
  invitedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
