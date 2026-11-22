/** Phone-OTP policy — see docs/architecture/PHONE-OTP-AUTH-DESIGN.md §6. */
export const OTP_CODE_LENGTH = 6;
export const OTP_TTL_MS = 5 * 60_000;
export const OTP_MAX_VERIFY_ATTEMPTS = 5;
/** Minimum gap between two sends to the same number. */
export const OTP_RESEND_COOLDOWN_MS = 30_000;
/** Per-phone send limits. */
export const OTP_PHONE_WINDOW_MS = 15 * 60_000;
export const OTP_PHONE_WINDOW_MAX = 3;
export const OTP_PHONE_DAY_MAX = 10;
/** Per-IP send limit. */
export const OTP_IP_WINDOW_MS = 60 * 60_000;
export const OTP_IP_WINDOW_MAX = 20;
/** Alert (warn log) once the global daily cap is this fraction used. */
export const OTP_CAP_ALERT_FRACTION = 0.8;
/** Challenges older than this are purged. */
export const OTP_RETENTION_MS = 24 * 60 * 60_000;
