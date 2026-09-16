const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Parses a duration string like "15m" / "12h" / "30d" (the shape of
 * REFRESH_TOKEN_EXPIRES_IN, ADMIN_REFRESH_TOKEN_EXPIRES_IN,
 * JWT_ACCESS_EXPIRES_IN) into milliseconds.
 * Deliberately minimal — no external "ms"-style dependency — since this is
 * the only place a non-JWT-signed duration (refresh token DB expiry, cookie
 * maxAge) needs converting from the env-sourced string.
 */
export function parseDurationMs(value: string): number {
  const match = /^(\d+)\s*(s|m|h|d)$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid duration string: "${value}"`);
  }
  const [, amount, unit] = match;
  return Number(amount) * UNIT_MS[unit];
}
