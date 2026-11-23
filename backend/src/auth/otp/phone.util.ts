/**
 * Normalises an Indian mobile number to E.164 ("+91XXXXXXXXXX").
 * Accepts "98765 43210", "09876543210", "919876543210", "+91-98765-43210".
 * Returns null for anything that is not a valid 10-digit Indian mobile
 * (must start 6–9). Never throws and never logs the input.
 */
export function normalizeIndianMobile(input: string): string | null {
  const compact = input.replace(/[\s\-()]/g, '');
  const match = /^(?:\+?91|0)?([6-9]\d{9})$/.exec(compact);
  return match ? `+91${match[1]}` : null;
}

/**
 * "+919876543210" → "9876543210": the 10-digit form customers type into the
 * profile and checkout phone fields. Anything that is not a +91 mobile is
 * returned unchanged (never guessed at).
 */
export function nationalIndianMobile(phoneE164: string): string {
  const match = /^\+91([6-9]\d{9})$/.exec(phoneE164);
  return match ? match[1] : phoneE164;
}

/** "+919876543210" → "+91******3210" for logs. */
export function maskPhone(phoneE164: string): string {
  return `${phoneE164.slice(0, 3)}${'*'.repeat(Math.max(0, phoneE164.length - 7))}${phoneE164.slice(-4)}`;
}
