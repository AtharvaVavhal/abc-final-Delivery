/**
 * Named IP-throttle budgets for `@nestjs/throttler` v6.
 *
 * Nest's default storage key is per handler + IP, not one global counter —
 * a blanket 20/60s on `GET /products` is what 429'd ordinary storefront
 * browsing. Tiers below are applied with `@Throttle` / `@SkipThrottle`
 * on the matching controllers; the module default covers everything else
 * (cart, uploads, admin mutations, session refresh).
 */
export const THROTTLE_TTL_MS = 60_000;

export const THROTTLE_LIMITS = {
  /** Login / register / password-reset — stricter than the old global 20. */
  auth: 10,
  /** Cart, uploads, admin, refresh, other mutations. */
  default: 60,
  /** Checkout preview, order create, payment initiate/verify, PIN lookup. */
  checkout: 40,
  /** Public catalog / categories / settings / product-review reads. */
  publicRead: 200,
} as const;

export const CUSTOMER_THROTTLE_MESSAGE =
  'Please wait a moment and try again.';

export const THROTTLE_AUTH = {
  default: { limit: THROTTLE_LIMITS.auth, ttl: THROTTLE_TTL_MS },
} as const;

export const THROTTLE_PUBLIC_READ = {
  default: { limit: THROTTLE_LIMITS.publicRead, ttl: THROTTLE_TTL_MS },
} as const;

export const THROTTLE_CHECKOUT = {
  default: { limit: THROTTLE_LIMITS.checkout, ttl: THROTTLE_TTL_MS },
} as const;
