/**
 * Cross-module constants. Values that are genuinely per-environment config
 * belong in common/config, not here.
 */
export const API_PREFIX = 'api/v1';

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

export const REFRESH_TOKEN_COOKIE_NAME = 'pf_refresh_token';
export const REFRESH_TOKEN_COOKIE_PATH = '/api/v1/auth/refresh';

/**
 * Progressive per-account login delay (§23) — finalized during the auth
 * build per §37. Indexed by `users.failedLoginAttempts` (prior failures
 * before the current attempt), clamped to the last entry: 0s, 1s, 2s, 5s,
 * 10s-capped.
 */
export const LOGIN_DELAY_CURVE_MS: readonly number[] = [
  0, 1000, 2000, 5000, 10000,
];

/** bcrypt cost factor for password hashing (§23). */
export const BCRYPT_COST = 12;

/** Password reset token validity window (§23) — 30 minutes. */
export const PASSWORD_RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024; // 10MB — stream-limited, see §22
export const UPLOAD_ALLOWED_MIME_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'application/pdf',
  // Short product/category loops for the storefront. Same Cloudinary
  // pipeline as images (`resource_type: auto`); never a second media store.
  'video/mp4',
  'video/webm',
];
