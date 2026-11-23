import { ConflictException, NotFoundException } from '@nestjs/common';
import { OrderStatus, PhotoReviewStatus } from '@prisma/client';
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
const CUSTOMIZATION_ID = '11111111-1111-4111-8111-111111111111';

function build(opts: {
  orderStatus?: OrderStatus;
  customization?: Record<string, unknown> | null;
  openPhotos?: number;
  customerEmail?: string | null;
  ownFile?: boolean;
}) {
  const tx = {
    orderItemCustomization: { update: jest.fn().mockResolvedValue({}) },
    user: {
      findUnique: jest.fn().mockResolvedValue({
        email:
          opts.customerEmail === undefined
            ? 'riya@example.test'
            : opts.customerEmail,
      }),
    },
  };
  const prisma = {
    order: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'order-1',
        orderNumber: 'PF-000042',
        userId: 'user-1',
        tenantId: 'tenant-a',
        status: opts.orderStatus ?? OrderStatus.PAID,
      }),
    },
    uploadedFile: {
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.ownFile === false ? null : { id: 'file-2' }),
    },
    orderItemCustomization: {
      findFirst: jest.fn().mockResolvedValue(
        opts.customization === undefined
          ? {
              id: CUSTOMIZATION_ID,
              reviewStatus: PhotoReviewStatus.PENDING,
              reviewNote: null,
              reviewedAt: null,
            }
          : opts.customization,
      ),
      count: jest.fn().mockResolvedValue(opts.openPhotos ?? 0),
      update: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const audit = { logTenantAction: jest.fn() };
  const notifications = { enqueueOutboxEvent: jest.fn() };
  const service = new OrdersService(
    prisma as never,
    notifications as never,
    audit as never,
  );
  return { service, prisma, tx, audit, notifications };
}

// resolveTenantAuditActor reads the actor's membership; keep it simple.
jest.mock('../common/audit/tenant-actor-attribution', () => ({
  resolveTenantAuditActor: jest
    .fn()
    .mockResolvedValue({ actorUserId: 'admin-1' }),
}));

describe('OrdersService.adminReviewPhoto', () => {
  it('approves a pending photo, clears the note, and writes an audit entry', async () => {
    const { service, tx, audit } = build({});
    const result = await service.adminReviewPhoto(
      tenantContext,
      admin,
      'order-1',
      CUSTOMIZATION_ID,
      { decision: 'APPROVE' },
    );

    expect(result.reviewStatus).toBe(PhotoReviewStatus.APPROVED);
    expect(result.reviewNote).toBeNull();
    expect(tx.orderItemCustomization.update).toHaveBeenCalledWith({
      where: { id: CUSTOMIZATION_ID },
      data: expect.objectContaining({
        reviewStatus: PhotoReviewStatus.APPROVED,
        reviewNote: null,
        reviewedByUserId: 'admin-1',
      }),
    });
    expect(audit.logTenantAction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        tenantId: 'tenant-a',
        action: 'order.photo_review',
        targetId: 'order-1',
      }),
    );
  });

  it('records the note when asking for a new photo', async () => {
    const { service, tx } = build({});
    const result = await service.adminReviewPhoto(
      tenantContext,
      admin,
      'order-1',
      CUSTOMIZATION_ID,
      { decision: 'REQUEST_CHANGES', note: 'Photo is too dark' },
    );

    expect(result.reviewStatus).toBe(PhotoReviewStatus.CHANGES_REQUESTED);
    expect(result.reviewNote).toBe('Photo is too dark');
    expect(tx.orderItemCustomization.update).toHaveBeenCalledTimes(1);
  });

  it('queues an email to the customer when asking for a new photo', async () => {
    const { service, notifications, tx } = build({});
    const result = await service.adminReviewPhoto(
      tenantContext,
      admin,
      'order-1',
      CUSTOMIZATION_ID,
      { decision: 'REQUEST_CHANGES', note: 'Photo is too dark' },
    );

    expect(result.notified).toBe(true);
    expect(notifications.enqueueOutboxEvent).toHaveBeenCalledTimes(1);
    const [txArg, event] = notifications.enqueueOutboxEvent.mock.calls[0];
    expect(txArg).toBe(tx); // same transaction as the decision
    expect(event).toMatchObject({
      eventType: 'ORDER_STATUS_CHANGED',
      aggregateId: 'order-1',
      payload: {
        kind: 'PHOTO_CHANGES_REQUESTED',
        orderNumber: 'PF-000042',
        email: 'riya@example.test',
        note: 'Photo is too dark',
      },
    });
    expect(event.eventKey).toContain(
      `PHOTO_CHANGES_REQUESTED:${CUSTOMIZATION_ID}`,
    );
  });

  it('does not queue anything for a phone-only customer (no email) and says so', async () => {
    const { service, notifications } = build({ customerEmail: null });
    const result = await service.adminReviewPhoto(
      tenantContext,
      admin,
      'order-1',
      CUSTOMIZATION_ID,
      { decision: 'REQUEST_CHANGES', note: 'Photo is too dark' },
    );
    expect(result.reviewStatus).toBe(PhotoReviewStatus.CHANGES_REQUESTED);
    expect(result.notified).toBe(false);
    expect(notifications.enqueueOutboxEvent).not.toHaveBeenCalled();
  });

  it('never emails on an approval', async () => {
    const { service, notifications } = build({});
    const result = await service.adminReviewPhoto(
      tenantContext,
      admin,
      'order-1',
      CUSTOMIZATION_ID,
      { decision: 'APPROVE' },
    );
    expect(result.notified).toBe(false);
    expect(notifications.enqueueOutboxEvent).not.toHaveBeenCalled();
  });

  it('is a no-op when the same decision is repeated (double click)', async () => {
    const reviewedAt = new Date('2026-11-23T10:00:00Z');
    const { service, prisma } = build({
      customization: {
        id: CUSTOMIZATION_ID,
        reviewStatus: PhotoReviewStatus.APPROVED,
        reviewNote: null,
        reviewedAt,
      },
    });
    const result = await service.adminReviewPhoto(
      tenantContext,
      admin,
      'order-1',
      CUSTOMIZATION_ID,
      { decision: 'APPROVE' },
    );
    expect(result.reviewedAt).toBe(reviewedAt);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses once production has started, and for unpaid orders', async () => {
    for (const status of [
      OrderStatus.IN_PRODUCTION,
      OrderStatus.PENDING_PAYMENT,
      OrderStatus.CANCELLED,
    ]) {
      const { service, prisma } = build({ orderStatus: status });
      await expect(
        service.adminReviewPhoto(
          tenantContext,
          admin,
          'order-1',
          CUSTOMIZATION_ID,
          {
            decision: 'APPROVE',
          },
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    }
  });

  it('404s for a photo that is not on this order (or is text-only)', async () => {
    const { service } = build({ customization: null });
    await expect(
      service.adminReviewPhoto(
        tenantContext,
        admin,
        'order-1',
        CUSTOMIZATION_ID,
        {
          decision: 'APPROVE',
        },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('looks the photo up inside the caller tenant and this order only', async () => {
    const { service, prisma } = build({});
    await service.adminReviewPhoto(
      tenantContext,
      admin,
      'order-1',
      CUSTOMIZATION_ID,
      {
        decision: 'APPROVE',
      },
    );
    expect(prisma.orderItemCustomization.findFirst).toHaveBeenCalledWith({
      where: {
        id: CUSTOMIZATION_ID,
        tenantId: 'tenant-a',
        orderItem: { orderId: 'order-1' },
        uploadedFileId: { not: null },
      },
    });
  });
});

describe('production gate (PHOTO_REVIEW_GATE)', () => {
  const original = process.env.PHOTO_REVIEW_GATE;
  afterEach(() => {
    if (original === undefined) delete process.env.PHOTO_REVIEW_GATE;
    else process.env.PHOTO_REVIEW_GATE = original;
  });

  it('does not look at photos at all while the gate is off', async () => {
    delete process.env.PHOTO_REVIEW_GATE;
    const { service, prisma } = build({
      orderStatus: OrderStatus.CONFIRMED,
      openPhotos: 3,
    });
    // Reach the private check directly: off means it returns before any query.
    await (
      service as unknown as {
        assertPhotosReadyForProduction(id: string): Promise<void>;
      }
    ).assertPhotosReadyForProduction('order-1');
    expect(prisma.orderItemCustomization.count).not.toHaveBeenCalled();
  });

  it('blocks production with a 409 while a photo is open, when enforced', async () => {
    process.env.PHOTO_REVIEW_GATE = 'enforced';
    const { service, prisma } = build({ openPhotos: 1 });
    await expect(
      (
        service as unknown as {
          assertPhotosReadyForProduction(id: string): Promise<void>;
        }
      ).assertPhotosReadyForProduction('order-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.orderItemCustomization.count).toHaveBeenCalledWith({
      where: {
        orderItem: { orderId: 'order-1' },
        uploadedFileId: { not: null },
        reviewStatus: {
          in: [PhotoReviewStatus.PENDING, PhotoReviewStatus.CHANGES_REQUESTED],
        },
      },
    });
  });

  it('is applied by the status-transition endpoint: CONFIRMED -> IN_PRODUCTION is refused and nothing is written', async () => {
    process.env.PHOTO_REVIEW_GATE = 'enforced';
    const { service, prisma } = build({
      orderStatus: OrderStatus.CONFIRMED,
      openPhotos: 2,
    });
    await expect(
      service.adminTransitionStatus(tenantContext, admin, 'order-1', {
        status: OrderStatus.IN_PRODUCTION,
      }),
    ).rejects.toThrow(/photo that has not been approved/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('allows production when enforced and every photo is approved', async () => {
    process.env.PHOTO_REVIEW_GATE = 'enforced';
    const { service } = build({ openPhotos: 0 });
    await expect(
      (
        service as unknown as {
          assertPhotosReadyForProduction(id: string): Promise<void>;
        }
      ).assertPhotosReadyForProduction('order-1'),
    ).resolves.toBeUndefined();
  });
});

describe('OrdersService.replaceCustomizationPhoto (customer)', () => {
  const requested = {
    id: CUSTOMIZATION_ID,
    reviewStatus: PhotoReviewStatus.CHANGES_REQUESTED,
    reviewNote: 'Too dark',
    reviewedAt: new Date('2026-11-23T10:00:00Z'),
  };

  it('swaps in the new file and sends the photo back to review', async () => {
    const { service, prisma } = build({ customization: requested });

    const result = await service.replaceCustomizationPhoto(
      'user-1',
      'order-1',
      CUSTOMIZATION_ID,
      'file-2',
    );

    expect(result.reviewStatus).toBe(PhotoReviewStatus.PENDING);
    expect(prisma.orderItemCustomization.update).toHaveBeenCalledWith({
      where: { id: CUSTOMIZATION_ID },
      data: {
        uploadedFileId: 'file-2',
        reviewStatus: PhotoReviewStatus.PENDING,
        reviewNote: null,
        reviewedAt: null,
        reviewedByUserId: null,
      },
    });
    // The file must be one this customer uploaded, in this store.
    expect(prisma.uploadedFile.findFirst).toHaveBeenCalledWith({
      where: { id: 'file-2', uploadedByUserId: 'user-1', tenantId: 'tenant-a' },
      select: { id: true },
    });
  });

  it("refuses someone else's order", async () => {
    const { service } = build({ customization: requested });
    await expect(
      service.replaceCustomizationPhoto(
        'someone-else',
        'order-1',
        CUSTOMIZATION_ID,
        'file-2',
      ),
    ).rejects.toThrow(/do not have access/);
  });

  it('refuses unless a new photo was actually requested', async () => {
    const { service } = build({
      customization: { ...requested, reviewStatus: PhotoReviewStatus.PENDING },
    });
    await expect(
      service.replaceCustomizationPhoto(
        'user-1',
        'order-1',
        CUSTOMIZATION_ID,
        'file-2',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses once production has started', async () => {
    const { service } = build({
      orderStatus: OrderStatus.IN_PRODUCTION,
      customization: requested,
    });
    await expect(
      service.replaceCustomizationPhoto(
        'user-1',
        'order-1',
        CUSTOMIZATION_ID,
        'file-2',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("refuses a file that is not the customer's own upload", async () => {
    const { service } = build({ customization: requested, ownFile: false });
    await expect(
      service.replaceCustomizationPhoto(
        'user-1',
        'order-1',
        CUSTOMIZATION_ID,
        'file-2',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
