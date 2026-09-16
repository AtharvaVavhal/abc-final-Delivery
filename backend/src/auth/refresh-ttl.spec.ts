import { refreshTtlMsForUser } from './refresh-ttl';

const TTLS = { customerMs: 30 * 86_400_000, adminMs: 12 * 3_600_000 };

describe('refreshTtlMsForUser', () => {
  it('gives customers the long-lived shopper session', () => {
    expect(
      refreshTtlMsForUser({ role: 'CUSTOMER', platformRole: null }, TTLS),
    ).toBe(TTLS.customerMs);
  });

  it('gives store admins the short privileged session', () => {
    expect(
      refreshTtlMsForUser({ role: 'ADMIN', platformRole: null }, TTLS),
    ).toBe(TTLS.adminMs);
  });

  it('gives platform super-admins the short privileged session even with a customer role column', () => {
    expect(
      refreshTtlMsForUser(
        { role: 'CUSTOMER', platformRole: 'SUPER_ADMIN' },
        TTLS,
      ),
    ).toBe(TTLS.adminMs);
  });
});
