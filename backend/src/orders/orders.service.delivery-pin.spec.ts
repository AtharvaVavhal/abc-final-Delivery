import { OrderStatus } from '@prisma/client';
import { OrdersService } from './orders.service';

jest.mock('../common/audit/tenant-actor-attribution', () => ({
  resolveTenantAuditActor: jest
    .fn()
    .mockResolvedValue({ actorUserId: 'admin-1' }),
}));

const tenantContext = {
  tenantId: 'tenant-a',
  source: 'membership-default',
  membership: { role: 'ADMIN' },
} as never;
const admin = {
  id: 'admin-1',
  email: 'a@example.test',
  role: 'ADMIN',
  platformRole: null,
  memberships: [{ tenantId: 'tenant-a', role: 'ADMIN' }],
} as never;

function build(status: OrderStatus) {
  const order = {
    id: 'order-1',
    orderNumber: 'PF-1',
    userId: 'user-1',
    tenantId: 'tenant-a',
    status,
  };
  const tx = {
    order: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    orderStatusHistory: { create: jest.fn() },
    user: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ email: null }),
    },
  };
  const prisma = {
    order: { findUnique: jest.fn().mockResolvedValue(order) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const service = new OrdersService(
    prisma as never,
    { enqueueOutboxEvent: jest.fn() } as never,
    { logTenantAction: jest.fn() } as never,
  );
  // Reading the view back is not under test.
  jest.spyOn(service, 'adminGetOrderDetail').mockResolvedValue({} as never);
  return { service, tx };
}

describe('delivery pin lifecycle', () => {
  it('erases the pin in the same update that marks the order delivered', async () => {
    const { service, tx } = build(OrderStatus.SHIPPED);
    await service.adminTransitionStatus(tenantContext, admin, 'order-1', {
      status: OrderStatus.DELIVERED,
    });
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', status: OrderStatus.SHIPPED },
      data: {
        status: OrderStatus.DELIVERED,
        shippingLatitude: null,
        shippingLongitude: null,
      },
    });
  });

  it('keeps the pin while the order is still on its way', async () => {
    const { service, tx } = build(OrderStatus.IN_PRODUCTION);
    await service.adminTransitionStatus(tenantContext, admin, 'order-1', {
      status: OrderStatus.SHIPPED,
    });
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', status: OrderStatus.IN_PRODUCTION },
      data: { status: OrderStatus.SHIPPED },
    });
  });
});
