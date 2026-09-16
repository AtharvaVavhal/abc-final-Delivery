import { isPrismaService, withTenantRlsContext } from './tenant-rls';

describe('isPrismaService / withTenantRlsContext', () => {
  it('does not treat a TransactionClient-shaped object with $transaction as PrismaService', () => {
    const tx = {
      $transaction: jest.fn(),
      $executeRaw: jest.fn(),
    };
    expect(isPrismaService(tx as never)).toBe(false);
  });

  it('treats an object with $extends as PrismaService', () => {
    const prisma = { $extends: jest.fn(), $transaction: jest.fn() };
    expect(isPrismaService(prisma as never)).toBe(true);
  });

  it('reuses the caller transaction instead of nesting when $transaction exists but $extends does not', async () => {
    const inner = { product: { findMany: jest.fn() } };
    const tx = {
      $transaction: jest.fn(),
      $executeRaw: jest.fn().mockResolvedValue(undefined),
    };
    const result = await withTenantRlsContext(tx as never, 'tenant-a', async () => {
      return inner;
    });
    expect(tx.$transaction).not.toHaveBeenCalled();
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(result).toBe(inner);
  });
});
