import { AuthService } from './auth.service';

/** Only the one method under test; the service has many unrelated deps. */
function build() {
  const prisma = {
    user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  // The method is private and the real service has many unrelated
  // dependencies, so test it on a bare instance with just `prisma`.
  const service = Object.create(AuthService.prototype) as unknown as {
    prisma: typeof prisma;
    saveLoginPhoneToProfile(user: unknown): Promise<void>;
  };
  service.prisma = prisma;
  return { service, prisma };
}

describe('AuthService.saveLoginPhoneToProfile', () => {
  it('copies the verified number into an empty profile phone, as the 10 digits customers type', async () => {
    const { service, prisma } = build();
    await service.saveLoginPhoneToProfile({
      id: 'u1',
      phoneE164: '+919876543210',
      phone: null,
    });
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', phone: null },
      data: { phone: '9876543210' },
    });
  });

  it('never overwrites a number the customer already saved', async () => {
    const { service, prisma } = build();
    await service.saveLoginPhoneToProfile({
      id: 'u1',
      phoneE164: '+919876543210',
      phone: '9000000000',
    });
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('guards the write itself, so a concurrent profile save is not clobbered', async () => {
    const { service, prisma } = build();
    await service.saveLoginPhoneToProfile({
      id: 'u1',
      phoneE164: '+919876543210',
      phone: null,
    });
    expect(prisma.user.updateMany.mock.calls[0][0].where).toEqual({
      id: 'u1',
      phone: null,
    });
  });

  it('does nothing for a password account with no verified phone', async () => {
    const { service, prisma } = build();
    await service.saveLoginPhoneToProfile({
      id: 'u2',
      phoneE164: null,
      phone: null,
    });
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
});
