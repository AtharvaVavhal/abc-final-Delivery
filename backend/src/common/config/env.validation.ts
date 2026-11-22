import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';
import { resolvePaymentCredentialsMasterKey } from './payment-credentials-master-key';

/**
 * Fails fast at boot if required environment variables are missing or malformed,
 * instead of surfacing as an obscure runtime error later.
 *
 * Two tiers:
 *   1. `EnvironmentVariables` below — validated in every environment
 *      (development, test, production). These have no safe default.
 *   2. `PRODUCTION_REQUIRED_KEYS` — integration config that `configuration.ts`
 *      deliberately defaults to `''` so local dev and the test/CI environment
 *      run without real Razorpay / Cloudinary / Resend credentials (no such
 *      network call is reachable there — see `.github/workflows/ci.yml` and
 *      `test/e2e/support/`). Without this second tier a misconfigured
 *      production boot *succeeds* and only fails later in subtle ways: an
 *      empty-string webhook-secret HMAC compare, a `localhost` CORS origin,
 *      a broken upload or email call. Enforced only when `NODE_ENV=production`.
 *
 * Error messages name the variable only — never a value — so a secret can
 * never land in a boot log or crash report.
 *
 * See docs/ops/ENVIRONMENT.md for the full per-variable matrix.
 */
class EnvironmentVariables {
  @IsIn(['development', 'production', 'test'])
  NODE_ENV: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL: string;

  @IsString()
  @IsNotEmpty()
  JWT_ACCESS_SECRET: string;

  @IsString()
  @IsNotEmpty()
  REFRESH_TOKEN_SECRET: string;
}

/**
 * Required when — and only when — `NODE_ENV=production`.
 *
 * `SENTRY_DSN` is intentionally absent: `Sentry.init` in `main.ts` is guarded
 * by it and is a no-op when unset (§30). It is *recommended* in production but
 * not load-bearing, so it stays optional to avoid a hard boot failure over
 * error reporting. `PORT` / `DATABASE_URL` / the JWT secrets are already
 * enforced in every environment above and are not repeated here.
 */
export const PRODUCTION_REQUIRED_KEYS = [
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
  // Phase 7 — production SaaS billing provider (docs/saas/DECISIONS.md
  // P7-D4 Part E) — a deliberately separate credential set from the three
  // merchant-commerce keys immediately above, never reused between them.
  'RAZORPAY_SAAS_KEY_ID',
  'RAZORPAY_SAAS_KEY_SECRET',
  'RAZORPAY_SAAS_WEBHOOK_SECRET',
  // Phase 8 (docs/saas/DECISIONS.md P8-D6) — single platform-wide
  // AES-256-GCM master key for merchant `PaymentAccount` credential
  // encryption. Presence checked here; format (base64, decodes to exactly
  // 32 bytes) checked separately by `invalidProductionMasterKey` below —
  // a production boot must not silently run with a missing OR malformed
  // key, and must never fall back to a hardcoded one.
  'PAYMENT_CREDENTIALS_MASTER_KEY',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
  'RESEND_API_KEY',
  'EMAIL_FROM_ADDRESS',
  'FRONTEND_URL',
  'BACKEND_URL',
] as const;

/**
 * Returns a safe (value-free) message for every production-required key that
 * is missing or blank. A whitespace-only value counts as missing.
 */
function missingProductionKeys(config: Record<string, unknown>): string[] {
  return PRODUCTION_REQUIRED_KEYS.filter((key) => {
    const value = config[key];
    return typeof value !== 'string' || value.trim() === '';
  }).map((key) => `${key} is required in production`);
}

/**
 * Format check for `PAYMENT_CREDENTIALS_MASTER_KEY`, separate from the
 * plain presence check above: a *present but malformed* value (wrong
 * length, not base64) must also fail boot in production, not be silently
 * accepted and only fail later at first use. Skipped when the key is
 * blank/missing — `missingProductionKeys` already reports that case, and
 * this function must never echo the invalid value itself into the message.
 */
function invalidProductionMasterKey(config: Record<string, unknown>): string[] {
  const raw = config['PAYMENT_CREDENTIALS_MASTER_KEY'];
  if (typeof raw !== 'string' || raw.trim() === '') {
    return [];
  }
  try {
    resolvePaymentCredentialsMasterKey(raw);
    return [];
  } catch {
    return [
      'PAYMENT_CREDENTIALS_MASTER_KEY is not a valid AES-256 key (must be base64-encoded, decoding to exactly 32 bytes)',
    ];
  }
}

/**
 * Phone-OTP keys are required in production only when the feature flag is on,
 * so the flag can ship off without MSG91 credentials. The console provider
 * (which logs codes) is refused in production outright.
 */
function otpProductionProblems(config: Record<string, unknown>): string[] {
  if (config['AUTH_OTP_ENABLED'] !== 'true') return [];
  const blank = (key: string): boolean => {
    const v = config[key];
    return typeof v !== 'string' || v.trim() === '';
  };
  const problems: string[] = [];
  if (blank('OTP_HMAC_SECRET')) {
    problems.push(
      'OTP_HMAC_SECRET is required in production when AUTH_OTP_ENABLED=true',
    );
  }
  if (config['OTP_SMS_PROVIDER'] === 'console') {
    problems.push('OTP_SMS_PROVIDER=console is not allowed in production');
  } else {
    for (const key of ['MSG91_AUTH_KEY', 'MSG91_OTP_TEMPLATE_ID']) {
      if (blank(key)) {
        problems.push(
          `${key} is required in production when AUTH_OTP_ENABLED=true`,
        );
      }
    }
  }
  return problems;
}

export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  const messages = errors.map((e) =>
    Object.values(e.constraints ?? {}).join(', '),
  );

  if (validatedConfig.NODE_ENV === 'production') {
    messages.push(
      ...missingProductionKeys(config),
      ...invalidProductionMasterKey(config),
      ...otpProductionProblems(config),
    );
  }

  if (messages.length > 0) {
    throw new Error(`Environment validation failed:\n${messages.join('\n')}`);
  }

  return validatedConfig;
}
