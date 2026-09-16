import { normalizePublicOrigin } from '../http/cors-origins';

/**
 * Typed application configuration, loaded once and exposed via ConfigModule.
 * All values are read from process.env — never hardcoded secrets.
 * See docs/architecture/BLUEPRINT-v1.2.md §31 (Environment Strategy).
 */
export interface AppConfig {
  nodeEnv: string;
  port: number;
  frontendUrl: string;
  backendUrl: string;
  database: {
    url: string;
  };
  auth: {
    accessTokenSecret: string;
    accessTokenExpiresIn: string;
    refreshTokenSecret: string;
    refreshTokenExpiresIn: string;
  };
  razorpay: {
    keyId: string;
    keySecret: string;
    webhookSecret: string;
  };
  /**
   * Phase 7 — production SaaS billing provider (docs/saas/DECISIONS.md
   * P7-D4 Part E). Deliberately a SEPARATE config block from `razorpay`
   * above (the Phase 8 merchant-commerce credentials) even though both
   * are Razorpay products — a distinct account, key pair, and webhook
   * secret, never reused between SaaS billing and merchant commerce.
   */
  razorpaySaas: {
    keyId: string;
    keySecret: string;
    webhookSecret: string;
  };
  /**
   * Phase 8 (P8-D6/D9, RATIFIED) — merchant `PaymentAccount` credential
   * encryption. One platform-wide AES-256-GCM master key, base64-encoded,
   * held as a single Render environment secret — never a per-merchant key,
   * never an external KMS. See `CredentialEncryptionService` and
   * `resolvePaymentCredentialsMasterKey` (this directory) for validation;
   * there is no fallback/default value — missing or malformed input always
   * throws, it is never silently treated as "encryption disabled."
   */
  paymentCredentials: {
    masterKey: string;
  };
  resend: {
    apiKey: string;
    emailFromAddress: string;
  };
  cloudinary: {
    cloudName: string;
    apiKey: string;
    apiSecret: string;
  };
  postal: {
    /** Base URL of the PIN-code lookup provider (see PostalLookupService).
     * Has a working public default — never a production-required secret,
     * and checkout stays usable if the provider is down. */
    providerBaseUrl: string;
  };
  /**
   * Per-module tenant-scoping rollout flags (decision P3-D1,
   * docs/saas/DECISIONS.md; Master Plan §9 "per-module rollout flag").
   * `'advisory'` = a would-be cross-tenant query is logged, never thrown;
   * `'enforced'` = thrown. Every module defaults to `'advisory'` when its
   * `TENANT_ENFORCEMENT_*` env var is unset or unrecognized — a missing or
   * misconfigured value must fail toward "logs, does not throw."
   *
   * None of these commerce tables carry a `tenantId` column yet (Phase 4's
   * backfill) — the tenant-scoped Prisma client
   * (`src/common/tenant/tenant-prisma.ts`) has nothing to scope them by
   * today, so `'enforced'` is a structural no-op for every key here until
   * Phase 4 adds the column, exactly as Master Plan §9's EXIT CRITERIA
   * anticipates ("Enforcement flags may still be advisory for modules
   * whose data Phase 4 hasn't scoped yet"). The flags exist now so Phase 4
   * only has to flip a value, not build the mechanism.
   */
  tenantEnforcement: Record<TenantEnforcementModule, TenantEnforcementMode>;
}

export type TenantEnforcementMode = 'advisory' | 'enforced';

export const TENANT_ENFORCEMENT_MODULES = [
  'products',
  'cart',
  'checkout',
  'orders',
  'payments',
  'invoices',
  'coupons',
  'reviews',
  'uploads',
  'appSetting',
  'notifications',
] as const;

export type TenantEnforcementModule =
  (typeof TENANT_ENFORCEMENT_MODULES)[number];

const ENV_KEY_BY_MODULE: Record<TenantEnforcementModule, string> = {
  products: 'TENANT_ENFORCEMENT_PRODUCTS',
  cart: 'TENANT_ENFORCEMENT_CART',
  checkout: 'TENANT_ENFORCEMENT_CHECKOUT',
  orders: 'TENANT_ENFORCEMENT_ORDERS',
  payments: 'TENANT_ENFORCEMENT_PAYMENTS',
  invoices: 'TENANT_ENFORCEMENT_INVOICES',
  coupons: 'TENANT_ENFORCEMENT_COUPONS',
  reviews: 'TENANT_ENFORCEMENT_REVIEWS',
  uploads: 'TENANT_ENFORCEMENT_UPLOADS',
  appSetting: 'TENANT_ENFORCEMENT_APP_SETTING',
  notifications: 'TENANT_ENFORCEMENT_NOTIFICATIONS',
};

function readEnforcementMode(envKey: string): TenantEnforcementMode {
  return process.env[envKey] === 'enforced' ? 'enforced' : 'advisory';
}

function loadTenantEnforcement(): Record<
  TenantEnforcementModule,
  TenantEnforcementMode
> {
  const result = {} as Record<TenantEnforcementModule, TenantEnforcementMode>;
  for (const mod of TENANT_ENFORCEMENT_MODULES) {
    result[mod] = readEnforcementMode(ENV_KEY_BY_MODULE[mod]);
  }
  return result;
}

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '4000', 10),
  frontendUrl: normalizePublicOrigin(
    process.env.FRONTEND_URL ?? 'http://localhost:5173',
  ),
  backendUrl: normalizePublicOrigin(
    process.env.BACKEND_URL ?? 'http://localhost:4000',
  ),
  database: {
    url: process.env.DATABASE_URL ?? '',
  },
  auth: {
    accessTokenSecret: process.env.JWT_ACCESS_SECRET ?? '',
    accessTokenExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshTokenSecret: process.env.REFRESH_TOKEN_SECRET ?? '',
    refreshTokenExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN ?? '30d',
  },
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID ?? '',
    keySecret: process.env.RAZORPAY_KEY_SECRET ?? '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? '',
  },
  razorpaySaas: {
    keyId: process.env.RAZORPAY_SAAS_KEY_ID ?? '',
    keySecret: process.env.RAZORPAY_SAAS_KEY_SECRET ?? '',
    webhookSecret: process.env.RAZORPAY_SAAS_WEBHOOK_SECRET ?? '',
  },
  paymentCredentials: {
    masterKey: process.env.PAYMENT_CREDENTIALS_MASTER_KEY ?? '',
  },
  resend: {
    apiKey: process.env.RESEND_API_KEY ?? '',
    emailFromAddress: process.env.EMAIL_FROM_ADDRESS ?? '',
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? '',
    apiKey: process.env.CLOUDINARY_API_KEY ?? '',
    apiSecret: process.env.CLOUDINARY_API_SECRET ?? '',
  },
  postal: {
    providerBaseUrl:
      process.env.POSTAL_LOOKUP_BASE_URL ?? 'https://api.pincodeapi.in/api/v1',
  },
  tenantEnforcement: loadTenantEnforcement(),
});
