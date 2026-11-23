import { OrderStatus, RefundStatus } from '@prisma/client';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { TenantContext } from '../common/tenant/tenant-context';
import { OrdersService } from './orders.service';

const tenantContext: TenantContext = {
  tenantId: 'tenant-a',
  source: 'membership-default',
  membership: { role: 'ADMIN' },
};

const admin: AuthenticatedUser = {
  id: 'admin-1',
  email: 'admin@example.test',
  role: 'ADMIN',
  platformRole: null,
  memberships: [{ tenantId: 'tenant-a', role: 'ADMIN' }],
};

/**
 * Focused on the one behavior Phase 9 adds to adminTransitionStatus: a
 * target status of REFUNDED must mark the order's PENDING Refund row
 * PROCESSED in the same transaction as the order CAS + history write (see
 * performRefundRecording). Full happy-path/view-assembly coverage for the
 * rest of adminTransitionStatus stays in orders.service.spec.ts and
 * order-lifecycle.util.spec.ts, same division as that file already notes.
 */
describe('OrdersService.adminTransitionStatus — REFUNDED closes the PENDING Refund loop', () => {
  function buildService(currentStatus: OrderStatus) {
    const txOrderUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const txRefundUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const txHistoryCreate = jest.fn().mockResolvedValue({});
    const txUserFindUniqueOrThrow = jest
      .fn()
      .mockResolvedValue({ email: 'customer@example.com' });

    const tx = {
      order: { updateMany: txOrderUpdateMany },
      refund: { updateMany: txRefundUpdateMany },
      orderStatusHistory: { create: txHistoryCreate },
      user: { findUniqueOrThrow: txUserFindUniqueOrThrow },
      tenantMembership: {
        findUnique: jest.fn().mockResolvedValue({ id: 'membership-1' }),
      },
    };

    const detailOrder = {
      id: 'order-1',
      orderNumber: 'PF-000001',
      userId: 'user-1',
      tenantId: 'tenant-a',
      status: OrderStatus.REFUNDED,
      subtotal: '100.00',
      shippingFee: '0.00',
      total: '100.00',
      discountAmount: '0.00',
      taxableAmount: '100.00',
      taxAmount: '0.00',
      taxMode: 'INCLUSIVE',
      taxRateSnapshot: null,
      couponCode: null,
      currency: 'INR',
      shippingRecipientName: 'Test Customer',
      shippingPhone: '9999999999',
      shippingAddressLine1: 'Line 1',
      shippingAddressLine2: null,
      shippingCity: 'Pune',
      shippingState: 'Maharashtra',
      shippingPostalCode: '411001',
      shippingCountry: 'India',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      items: [],
      statusHistory: [],
      paymentAttempts: [],
    };

    const prisma = {
      order: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'order-1',
            userId: 'user-1',
            tenantId: 'tenant-a',
            orderNumber: 'PF-000001',
            status: currentStatus,
          })
          .mockResolvedValueOnce(detailOrder),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<void>) =>
        fn(tx),
      ),
    };

    const notificationsService = { enqueueOutboxEvent: jest.fn() };
    const audit = { logTenantAction: jest.fn().mockResolvedValue(undefined) };
    const service = new OrdersService(
      prisma as never,
      notificationsService as never,
      audit as never,
    );
    return { service, prisma, tx, audit };
  }

  it('marks the PENDING Refund row PROCESSED and writes the order CAS + history atomically for PAID -> REFUNDED', async () => {
    const { service, tx } = buildService(OrderStatus.PAID);

    await service.adminTransitionStatus(tenantContext, admin, 'order-1', {
      status: OrderStatus.REFUNDED,
    });

    expect(tx.refund.updateMany).toHaveBeenCalledWith({
      where: {
        status: RefundStatus.PENDING,
        paymentAttempt: { orderId: 'order-1' },
      },
      data: { status: RefundStatus.PROCESSED },
    });
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', status: OrderStatus.PAID },
      data: {
        status: OrderStatus.REFUNDED,
        shippingLatitude: null,
        shippingLongitude: null,
      },
    });
    expect(tx.orderStatusHistory.create).toHaveBeenCalled();

    // Both writes happened via the same $transaction callback invocation —
    // not two separate transactions — which is what makes this atomic.
    const prisma = (
      service as unknown as { prisma: { $transaction: jest.Mock } }
    ).prisma;
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it.each([
    OrderStatus.PAID,
    OrderStatus.CONFIRMED,
    OrderStatus.IN_PRODUCTION,
    OrderStatus.SHIPPED,
    OrderStatus.DELIVERED,
    OrderStatus.CANCELLED,
  ])(
    'reaches REFUNDED and closes the refund loop from %s (§14 CAS table)',
    async (from) => {
      const { service, tx } = buildService(from);

      await service.adminTransitionStatus(tenantContext, admin, 'order-1', {
        status: OrderStatus.REFUNDED,
      });

      expect(tx.refund.updateMany).toHaveBeenCalledTimes(1);
      expect(tx.order.updateMany).toHaveBeenCalledWith({
        where: { id: 'order-1', status: from },
        data: {
          status: OrderStatus.REFUNDED,
          shippingLatitude: null,
          shippingLongitude: null,
        },
      });
    },
  );

  it('does not touch the Refund table for a non-REFUNDED transition (PAID -> CONFIRMED)', async () => {
    const { service, tx } = buildService(OrderStatus.PAID);

    await service.adminTransitionStatus(tenantContext, admin, 'order-1', {
      status: OrderStatus.CONFIRMED,
    });

    expect(tx.refund.updateMany).not.toHaveBeenCalled();
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', status: OrderStatus.PAID },
      data: { status: OrderStatus.CONFIRMED },
    });
  });
});
