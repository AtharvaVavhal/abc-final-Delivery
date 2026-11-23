import { OrderStatus, Prisma } from '@prisma/client';
import { AdminService } from './admin.service';

const TENANT_ID = 'tenant-1';
const tenantContext = { tenantId: TENANT_ID } as never;

function build(rows: unknown[], priorBuyerIds: string[] = []) {
  const prisma = {
    order: {
      findMany: jest.fn().mockResolvedValue(rows),
      groupBy: jest
        .fn()
        .mockResolvedValue(priorBuyerIds.map((userId) => ({ userId }))),
    },
  };
  const service = new AdminService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, prisma };
}

describe('AdminService.getDashboardOverview', () => {
  const now = new Date('2026-11-23T10:00:00Z');

  it('reads only this tenant, paid-or-later orders, for the two periods', async () => {
    const { service, prisma } = build([]);
    await service.getDashboardOverview(tenantContext, 7, now);

    const args = prisma.order.findMany.mock.calls[0][0];
    expect(args.where.tenantId).toBe(TENANT_ID);
    expect(args.where.status.in).toEqual([
      OrderStatus.PAID,
      OrderStatus.CONFIRMED,
      OrderStatus.IN_PRODUCTION,
      OrderStatus.SHIPPED,
      OrderStatus.DELIVERED,
    ]);
    // 14 days = 7 current + 7 previous.
    const span = args.where.createdAt.lt.getTime() - args.where.createdAt.gte.getTime();
    expect(span).toBe(14 * 86_400_000);
    expect(args.select).toEqual({ createdAt: true, total: true, userId: true });
  });

  it('returns both periods, zero-filled, and marks repeat buyers from earlier orders', async () => {
    const rows = [
      { createdAt: new Date('2026-11-20T10:00:00Z'), total: new Prisma.Decimal('999.00'), userId: 'a' },
      { createdAt: new Date('2026-11-21T10:00:00Z'), total: new Prisma.Decimal('500.00'), userId: 'b' },
      { createdAt: new Date('2026-11-12T10:00:00Z'), total: new Prisma.Decimal('300.00'), userId: 'a' },
    ];
    const { service, prisma } = build(rows, ['a']);

    const view = await service.getDashboardOverview(tenantContext, 7, now);

    expect(view).toMatchObject({ days: 7, currency: 'INR', timezone: 'Asia/Kolkata' });
    expect(view.current.daily).toHaveLength(7);
    expect(view.previous.daily).toHaveLength(7);
    expect(view.current.netSales).toBe('1499.00');
    expect(view.current.orders).toBe(2);
    expect(view.current.averageOrderValue).toBe('749.50');
    expect(view.previous.netSales).toBe('300.00');
    expect(view.current.repeatBuyers).toBe(1);
    expect(view.current.repeatCustomerRate).toBe(0.5);
    // Prior-order lookups are tenant-scoped too.
    for (const [call] of prisma.order.groupBy.mock.calls) {
      expect(call.where.tenantId).toBe(TENANT_ID);
    }
  });

  it('skips the prior-order lookup when nobody bought', async () => {
    const { service, prisma } = build([]);
    const view = await service.getDashboardOverview(tenantContext, 30, now);
    expect(prisma.order.groupBy).not.toHaveBeenCalled();
    expect(view.current.orders).toBe(0);
    expect(view.current.repeatCustomerRate).toBeNull();
  });
});
