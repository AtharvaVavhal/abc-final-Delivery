/** Seconds before "Send again" is enabled — matches the server's 30 s cooldown. */
export const OTP_RESEND_SECONDS = 30

/** Mirrors the server's rule (backend auth/otp/phone.util.ts): a 10-digit
 * Indian mobile starting 6–9, optionally prefixed +91 / 91 / 0. UX only —
 * the server re-validates and is the source of truth. */
export function isValidIndianMobile(input: string): boolean {
  return /^(?:\+?91|0)?[6-9]\d{9}$/.test(input.replace(/[\s\-()]/g, ''))
}
