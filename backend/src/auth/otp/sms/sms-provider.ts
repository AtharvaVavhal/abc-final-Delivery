/**
 * Delivery-only SMS abstraction. The OTP code is generated, hashed, expired
 * and verified by OtpService — a provider only delivers a message. This keeps
 * the provider swappable (e.g. a later WhatsApp channel) and verification
 * fully testable. Abstract class, not an interface, so it can be a Nest DI token.
 */
export abstract class SmsProvider {
  /** Deliver `code` to `phoneE164` using the approved OTP template. Throws on failure. */
  abstract sendOtp(phoneE164: string, code: string): Promise<void>;
}
