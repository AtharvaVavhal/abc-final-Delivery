/**
 * Mirrors backend/src/auth/auth.service.ts's PublicUser/AuthTokenResult and
 * backend/src/users/dto/user-profile-view.interface.ts's UserProfileView.
 */
export interface PublicUser {
  id: string
  /** Null for phone-only (OTP) customers. */
  email: string | null
  role: string
  createdAt: string
}

export interface AuthTokenResult {
  accessToken: string
  user: PublicUser
}

export interface UserProfileView {
  id: string
  /** Null for phone-only (OTP) customers. */
  email: string | null
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  country: string | null
  phone: string | null
  role: string
  createdAt: string
}

/** PATCH /users/me's whitelisted body (backend/src/users/dto/update-profile.dto.ts,
 * class-validator whitelist:true + forbidNonWhitelisted:true — confirmed live
 * that sending email/role/password gets a 400, not a silent strip). Every
 * field is independently optional: an absent key leaves that column
 * untouched (true partial update), while an explicit `null` clears it —
 * also confirmed live. Never send a literal `""`; the backend does not
 * normalize that to null itself, it stores the empty string verbatim. */
export type UpdateProfilePayload = Partial<
  Pick<UserProfileView, 'addressLine1' | 'addressLine2' | 'city' | 'state' | 'postalCode' | 'country' | 'phone'>
>
