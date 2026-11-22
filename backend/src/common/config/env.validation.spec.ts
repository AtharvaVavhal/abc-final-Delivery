import 'reflect-metadata';
import { PRODUCTION_REQUIRED_KEYS, validateEnv } from './env.validation';

/**
 * Base config with the always-required variables set and every integration
 * secret deliberately unset — the shape local dev and CI actually run with.
 */
const BASE = {
  NODE_ENV: 'development',
  PORT: '4000',
  DATABASE_URL:
    'postgresql://user:pass@localhost:5432/printforge?schema=public',
  JWT_ACCESS_SECRET: 'dev-access-secret',
  REFRESH_TOKEN_SECRET: 'dev-refresh-secret',
};

/** Placeholder (non-secret) values for every production-required key. */
const PROD_INTEGRATION: Record<string, string> = {
  RAZORPAY_KEY_ID: 'rzp_live_placeholder',
  RAZORPAY_KEY_SECRET: 'placeholder',
  RAZORPAY_WEBHOOK_SECRET: 'placeholder',
  RAZORPAY_SAAS_KEY_ID: 'rzp_live_saas_placeholder',
  RAZORPAY_SAAS_KEY_SECRET: 'placeholder',
  RAZORPAY_SAAS_WEBHOOK_SECRET: 'placeholder',
  // 32 random bytes, base64 — a validly-SHAPED placeholder (not a real
  // secret; this exact value is also not used anywhere outside this test
  // file/`.env.test`, see ENVIRONMENT.md's own note on that distinction).
  PAYMENT_CREDENTIALS_MASTER_KEY: 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=',
  CLOUDINARY_CLOUD_NAME: 'printforge',
  CLOUDINARY_API_KEY: 'placeholder',
  CLOUDINARY_API_SECRET: 'placeholder',
  RESEND_API_KEY: 're_placeholder',
  EMAIL_FROM_ADDRESS: 'no-reply@printforge.in',
  FRONTEND_URL: 'https://www.printforge.in',
  BACKEND_URL: 'https://api.printforge.in',
};

describe('validateEnv', () => {
  it('accepts a development config with every integration secret unset', () => {
    expect(() => validateEnv({ ...BASE })).not.toThrow();
  });

  it('accepts a test config with every integration secret unset', () => {
    expect(() => validateEnv({ ...BASE, NODE_ENV: 'test' })).not.toThrow();
  });

  it('rejects any environment when an always-required secret is blank', () => {
    expect(() => validateEnv({ ...BASE, JWT_ACCESS_SECRET: '' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('rejects a production boot when integration variables are unset', () => {
    expect(() => validateEnv({ ...BASE, NODE_ENV: 'production' })).toThrow(
      /is required in production/,
    );
  });

  it('names every missing production variable', () => {
    let message = '';
    try {
      validateEnv({ ...BASE, NODE_ENV: 'production' });
    } catch (error) {
      message = (error as Error).message;
    }
    for (const key of PRODUCTION_REQUIRED_KEYS) {
      expect(message).toContain(`${key} is required in production`);
    }
  });

  it('never echoes a provided value back in the error message', () => {
    let message = '';
    try {
      validateEnv({
        ...BASE,
        NODE_ENV: 'production',
        RAZORPAY_KEY_SECRET: 'super-secret-do-not-log',
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain('super-secret-do-not-log');
    // The one key that WAS supplied must not be reported as missing.
    expect(message).not.toContain('RAZORPAY_KEY_SECRET is required');
  });

  it('treats a whitespace-only production value as missing', () => {
    expect(() =>
      validateEnv({
        ...BASE,
        NODE_ENV: 'production',
        ...PROD_INTEGRATION,
        RESEND_API_KEY: '   ',
      }),
    ).toThrow(/RESEND_API_KEY is required in production/);
  });

  describe('phone-OTP settings', () => {
    const prod = { ...BASE, NODE_ENV: 'production', ...PROD_INTEGRATION };

    it('needs no OTP keys while the flag is off', () => {
      expect(() => validateEnv({ ...prod })).not.toThrow();
    });

    it('requires the HMAC secret and MSG91 keys once the flag is on', () => {
      expect(() => validateEnv({ ...prod, AUTH_OTP_ENABLED: 'true' })).toThrow(
        /OTP_HMAC_SECRET is required[\s\S]*MSG91_AUTH_KEY is required[\s\S]*MSG91_OTP_TEMPLATE_ID is required/,
      );
    });

    it('refuses the console provider in production', () => {
      expect(() =>
        validateEnv({
          ...prod,
          AUTH_OTP_ENABLED: 'true',
          OTP_HMAC_SECRET: 'x',
          OTP_SMS_PROVIDER: 'console',
        }),
      ).toThrow(/OTP_SMS_PROVIDER=console is not allowed in production/);
    });

    it('requires the WhatsApp keys when the WhatsApp provider is selected', () => {
      expect(() =>
        validateEnv({
          ...prod,
          AUTH_OTP_ENABLED: 'true',
          OTP_HMAC_SECRET: 'x',
          OTP_SMS_PROVIDER: 'msg91-whatsapp',
          MSG91_AUTH_KEY: 'k',
        }),
      ).toThrow(
        /MSG91_WHATSAPP_INTEGRATED_NUMBER is required[\s\S]*MSG91_WHATSAPP_TEMPLATE_NAME is required[\s\S]*MSG91_WHATSAPP_TEMPLATE_NAMESPACE is required/,
      );
    });

    it('accepts a fully-configured WhatsApp OTP production boot (no SMS template id needed)', () => {
      expect(() =>
        validateEnv({
          ...prod,
          AUTH_OTP_ENABLED: 'true',
          OTP_HMAC_SECRET: 'x',
          OTP_SMS_PROVIDER: 'msg91-whatsapp',
          MSG91_AUTH_KEY: 'k',
          MSG91_WHATSAPP_INTEGRATED_NUMBER: '919999999999',
          MSG91_WHATSAPP_TEMPLATE_NAME: 'login_otp',
          MSG91_WHATSAPP_TEMPLATE_NAMESPACE: 'ns',
        }),
      ).not.toThrow();
    });

    it('requires RENFLAIR_API_KEY when the Renflair provider is selected', () => {
      expect(() =>
        validateEnv({
          ...prod,
          AUTH_OTP_ENABLED: 'true',
          OTP_HMAC_SECRET: 'x',
          OTP_SMS_PROVIDER: 'renflair',
        }),
      ).toThrow(/RENFLAIR_API_KEY is required/);
      expect(() =>
        validateEnv({
          ...prod,
          AUTH_OTP_ENABLED: 'true',
          OTP_HMAC_SECRET: 'x',
          OTP_SMS_PROVIDER: 'renflair',
          RENFLAIR_API_KEY: 'k',
        }),
      ).not.toThrow();
    });

    it('accepts a fully-configured OTP production boot', () => {
      expect(() =>
        validateEnv({
          ...prod,
          AUTH_OTP_ENABLED: 'true',
          OTP_HMAC_SECRET: 'x',
          MSG91_AUTH_KEY: 'k',
          MSG91_OTP_TEMPLATE_ID: 't',
        }),
      ).not.toThrow();
    });
  });

  it('accepts a fully-configured production boot', () => {
    expect(() =>
      validateEnv({ ...BASE, NODE_ENV: 'production', ...PROD_INTEGRATION }),
    ).not.toThrow();
  });

  // ─── PAYMENT_CREDENTIALS_MASTER_KEY (P8-D6) ─────────────────────────

  describe('PAYMENT_CREDENTIALS_MASTER_KEY', () => {
    it('does not require it outside production', () => {
      expect(() => validateEnv({ ...BASE })).not.toThrow();
      expect(() => validateEnv({ ...BASE, NODE_ENV: 'test' })).not.toThrow();
    });

    it('rejects a production boot when it is unset — no dev/default fallback', () => {
      expect(() =>
        validateEnv({
          ...BASE,
          NODE_ENV: 'production',
          ...PROD_INTEGRATION,
          PAYMENT_CREDENTIALS_MASTER_KEY: undefined,
        }),
      ).toThrow(/PAYMENT_CREDENTIALS_MASTER_KEY is required in production/);
    });

    it('rejects a production boot when it is present but the wrong length', () => {
      expect(() =>
        validateEnv({
          ...BASE,
          NODE_ENV: 'production',
          ...PROD_INTEGRATION,
          PAYMENT_CREDENTIALS_MASTER_KEY: Buffer.from('too-short').toString(
            'base64',
          ),
        }),
      ).toThrow(/PAYMENT_CREDENTIALS_MASTER_KEY is not a valid AES-256 key/);
    });

    it('rejects a production boot when it is not valid base64', () => {
      expect(() =>
        validateEnv({
          ...BASE,
          NODE_ENV: 'production',
          ...PROD_INTEGRATION,
          PAYMENT_CREDENTIALS_MASTER_KEY: 'not base64 at all !!! ***',
        }),
      ).toThrow(/PAYMENT_CREDENTIALS_MASTER_KEY is not a valid AES-256 key/);
    });

    it('never echoes the invalid value back in the error message', () => {
      let message = '';
      try {
        validateEnv({
          ...BASE,
          NODE_ENV: 'production',
          ...PROD_INTEGRATION,
          PAYMENT_CREDENTIALS_MASTER_KEY: 'super-secret-do-not-log',
        });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toContain('super-secret-do-not-log');
    });
  });
});
