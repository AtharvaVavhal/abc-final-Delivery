import {
  CUSTOMER_THROTTLE_MESSAGE,
  THROTTLE_LIMITS,
  THROTTLE_TTL_MS,
} from './throttle.constants';

describe('throttle tiers', () => {
  it('keeps auth stricter than mutations and public reads materially more generous', () => {
    expect(THROTTLE_LIMITS.auth).toBeLessThan(THROTTLE_LIMITS.default);
    expect(THROTTLE_LIMITS.auth).toBeLessThan(20);
    expect(THROTTLE_LIMITS.default).toBeGreaterThan(20);
    expect(THROTTLE_LIMITS.checkout).toBeGreaterThan(20);
    expect(THROTTLE_LIMITS.publicRead).toBeGreaterThanOrEqual(180);
    expect(THROTTLE_TTL_MS).toBe(60_000);
    expect(CUSTOMER_THROTTLE_MESSAGE).toBe(
      'Please wait a moment and try again.',
    );
  });
});
