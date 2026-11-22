import { Role } from '@prisma/client';

/**
 * Read-side response shape for GET/PATCH /users/me (§20). Deliberately
 * excludes passwordHash, tokenVersion, failedLoginAttempts,
 * passwordResetTokenHash, passwordResetExpiresAt, isActive — never
 * built by spreading the User row, always assembled field-by-field
 * (see UsersService.toProfileView) so a future schema addition can't
 * silently leak into this response.
 */
export interface UserProfileView {
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
  createdAt: Date;
}
