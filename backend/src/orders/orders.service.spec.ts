import { ConflictException } from '@nestjs/common';
import { OrderStatus, PhotoReviewStatus } from '@prisma/client';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { TenantContext } from '../common/tenant/tenant-context';
import { OrdersService } from './orders.service';

/**
 * Focused on the one behavior explicitly asked for: the admin
 * status-update path rejects an illegal transition before ever attempting
 * a write. Full happy-path coverage (successful transitions, manual-refund
 * flagging, view assembly) is exercised via live curl testing against a
 * real database, same as every other phase this session — a faithful
 * mock of the whole read/write/outbox chain here would be brittle for
 * little extra signal over order-lifecycle.util.spec.ts's pure-function
 * coverage of the same rule.
 */
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

describe('OrdersService.adminTransitionStatus — illegal transition rejection', () => {
  function buildService(currentStatus: OrderStatus) {
    const prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'order-1',
          userId: 'user-1',
          tenantId: 'tenant-a',
          status: currentStatus,
        }),
        updateMany: jest.fn(),
      },
      paymentAttempt: {
        findFirst: jest.fn(),
      },
    };
    const notificationsService = { enqueueOutboxEvent: jest.fn() };
    const audit = { logTenantAction: jest.fn() };
    const service = new OrdersService(
      prisma as never,
      notificationsService as never,
      audit as never,
    );
    return { service, prisma };
  }

  it('rejects PENDING_PAYMENT -> SHIPPED with 409 and never writes', async () => {
    const { service, prisma } = buildService(OrderStatus.PENDING_PAYMENT);

    await expect(
      service.adminTransitionStatus(tenantContext, admin, 'order-1', {
        status: OrderStatus.SHIPPED,
      }),
    ).rejects.toThrow(ConflictException);
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a backwards transition (DELIVERED -> IN_PRODUCTION) with 409', async () => {
    const { service, prisma } = buildService(OrderStatus.DELIVERED);

    await expect(
      service.adminTransitionStatus(tenantContext, admin, 'order-1', {
        status: OrderStatus.IN_PRODUCTION,
      }),
    ).rejects.toThrow(ConflictException);
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('rejects transitioning out of a terminal REFUNDED order', async () => {
    const { service, prisma } = buildService(OrderStatus.REFUNDED);

    await expect(
      service.adminTransitionStatus(tenantContext, admin, 'order-1', {
        status: OrderStatus.CONFIRMED,
      }),
    ).rejects.toThrow(ConflictException);
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('never looks up a captured payment attempt for a rejected CANCELLED transition', async () => {
    const { service, prisma } = buildService(OrderStatus.SHIPPED);

    await expect(
      service.adminTransitionStatus(tenantContext, admin, 'order-1', {
        status: OrderStatus.CANCELLED,
      }),
    ).rejects.toThrow(ConflictException);
    expect(prisma.paymentAttempt.findFirst).not.toHaveBeenCalled();
  });
});

describe('OrdersService list rows — who the order is for', () => {
  it('adminRecentOrders exposes the shipping recipient name from the order snapshot', async () => {
    const prisma = {
      order: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'order-1',
            orderNumber: 'PF-000001',
            status: OrderStatus.PAID,
            total: '1499.00',
            currency: 'INR',
            createdAt: new Date('2026-11-23T10:00:00Z'),
            shippingRecipientName: 'Riya Sharma',
            items: [
              {
                quantity: 2,
                customizations: [{ reviewStatus: PhotoReviewStatus.PENDING }],
              },
            ],
            paymentAttempts: [],
          },
        ]),
      },
    };
    const service = new OrdersService(
      prisma as never,
      {} as never,
      {} as never,
    );

    const [row] = await service.adminRecentOrders(tenantContext, 10);

    expect(row.recipientName).toBe('Riya Sharma');
    expect(row.photoReview).toBe('TO_REVIEW');
    expect(row.itemCount).toBe(2);
    expect(prisma.order.findMany.mock.calls[0][0].where).toEqual({
      tenantId: 'tenant-a',
    });
  });

  it('does not report a photo on an unpaid or cancelled order as "to review"', async () => {
    for (const status of [
      OrderStatus.PENDING_PAYMENT,
      OrderStatus.PAYMENT_FAILED,
      OrderStatus.CANCELLED,
    ]) {
      const prisma = {
        order: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'order-1',
              orderNumber: 'PF-000009',
              status,
              total: '999.00',
              currency: 'INR',
              createdAt: new Date('2026-11-23T10:00:00Z'),
              shippingRecipientName: 'Riya Sharma',
              items: [
                {
                  quantity: 1,
                  customizations: [{ reviewStatus: PhotoReviewStatus.PENDING }],
                },
              ],
              paymentAttempts: [],
            },
          ]),
        },
      };
      const service = new OrdersService(
        prisma as never,
        {} as never,
        {} as never,
      );
      const [row] = await service.adminRecentOrders(tenantContext, 10);
      expect(row.photoReview).toBe('NONE');
    }
  });
});
