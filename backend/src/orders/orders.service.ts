import { randomUUID } from 'crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Order,
  OrderStatus,
  PaymentAttemptStatus,
  PhotoReviewStatus,
  Prisma,
  RefundStatus,
} from '@prisma/client';
import { PrismaService } from '../common/database/prisma.service';
import { PaginatedResult } from '../common/types/api-response.interface';
import { Role } from '../common/enums/role.enum';
import {
  decimalToPaise,
  paiseToDecimalString,
} from '../cart/pricing/money.util';
import { AuditService } from '../common/audit/audit.service';
import { resolveTenantAuditActor } from '../common/audit/tenant-actor-attribution';
import { assertObjectInTenant } from '../common/tenant/object-auth';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { TenantContext } from '../common/tenant/tenant-context';
import { NotificationsService } from '../notifications/notifications.service';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { ListAdminOrdersQueryDto } from '../admin/dto/list-admin-orders-query.dto';
import { UpdateOrderStatusDto } from '../admin/dto/update-order-status.dto';
import { ReviewPhotoDto } from '../admin/dto/review-photo.dto';
import {
  isPhotoReviewGateEnforced,
  PHOTO_REVIEW_BLOCKS_PRODUCTION_MESSAGE,
  photoReviewWhere,
  summarisePhotoReview,
} from './photo-review.util';
import {
  OrderDetailView,
  OrderListItemView,
  OrderStatusHistoryView,
  PaymentAttemptView,
  RefundView,
} from './dto/order-view.interface';
import {
  assertTransitionAllowed,
  orderNeedsRefund,
} from './order-lifecycle.util';

const ORDER_NUMBER_COUNTER_KEY = 'order_number_counter';

interface Actor {
  role: Role;
  actorId: string;
}

/**
 * Phase 5 W8 — present only for an ADMIN-initiated transition (never the
 * customer-facing `cancelOrder` path, which shares `performCancellation`/
 * `transitionOrderWithHistory` with the admin path but must never produce
 * a TenantAuditLog row of its own: a storefront customer is not a tenant
 * actor). When present, the audited private method writes exactly one
 * TenantAuditLog row inside the SAME transaction as the order mutation.
 */
interface TenantAuditContext {
  tenantContext: TenantContext;
  actor: AuthenticatedUser;
}

const ORDER_LIST_INCLUDE = {
  items: {
    select: {
      quantity: true,
      customizations: {
        where: { uploadedFileId: { not: null } },
        select: { reviewStatus: true },
      },
    },
  },
  paymentAttempts: {
    select: {
      refunds: {
        where: { status: RefundStatus.PENDING },
        select: { id: true },
      },
    },
  },
} satisfies Prisma.OrderInclude;

type OrderListRow = Prisma.OrderGetPayload<{
  include: typeof ORDER_LIST_INCLUDE;
}>;

const ORDER_DETAIL_INCLUDE = {
  items: {
    include: { customizations: true },
    orderBy: { id: 'asc' as const },
  },
  statusHistory: { orderBy: { createdAt: 'asc' as const } },
  paymentAttempts: {
    include: { refunds: true },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.OrderInclude;

type OrderWithDetail = Prisma.OrderGetPayload<{
  include: typeof ORDER_DETAIL_INCLUDE;
}>;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * §37 TODO ("Order-number generation mechanism — Postgres sequence or a
   * locked counter row in app_settings; either is acceptable, pick one
   * during Phase 1" — never picked): implemented as the app_settings
   * option, via an atomic INSERT...ON CONFLICT DO UPDATE...RETURNING
   * against a counter row — race-safe under concurrent checkouts without a
   * separate lock statement, no migration needed since app_settings
   * already exists (§15).
   *
   * Must be called with the caller's own transaction client so the
   * increment commits/rolls back atomically with the Order it numbers —
   * checkout owns order creation (§17); this is the one thing orders
   * exposes for it to consume (the checkout→orders dependency arrow, §17).
   */
  async generateOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
    const rows = await tx.$queryRaw<{ value: string }[]>`
      INSERT INTO app_settings (id, key, value, "updatedAt")
      VALUES (${randomUUID()}, ${ORDER_NUMBER_COUNTER_KEY}, '1', now())
      ON CONFLICT (key) DO UPDATE
        SET value = (app_settings.value::integer + 1)::text, "updatedAt" = now()
      RETURNING value
    `;
    const counter = rows[0].value;
    return `PF-${counter.padStart(6, '0')}`;
  }

  /**
   * Reviews' verified-purchase gate (PHASE-10-PROPOSAL.md §1.1/R1) — the
   * exact OrderItem, on a DELIVERED order, that proves this user bought
   * this specific product. Exposed here rather than ReviewsService reaching
   * into order/order-item tables directly, matching this codebase's
   * convention of routing a cross-module read through the owning module's
   * service (e.g. checkout calls `generateOrderNumber` above rather than
   * hand-rolling its own counter logic). Takes the caller's own transaction
   * client, same reason `generateOrderNumber` does: the eligibility check
   * has to compose atomically with whatever the caller does next inside
   * its own transaction (here, creating the Review), not run as a separate
   * pre-check a concurrent write could invalidate in between. Any
   * qualifying item is sufficient — which one doesn't matter, since it's
   * the same product either way.
   */
  async findDeliveredOrderItemForProduct(
    tx: Prisma.TransactionClient,
    userId: string,
    productId: string,
  ): Promise<{ id: string; tenantId: string } | null> {
    return tx.orderItem.findFirst({
      where: {
        productId,
        order: { userId, status: OrderStatus.DELIVERED },
      },
      select: { id: true, tenantId: true },
    });
  }

  // ─── Customer-facing (GET /orders, GET /orders/:id, POST /orders/:id/cancel) ──

  async listOrdersForUser(
    userId: string,
    query: ListOrdersQueryDto,
  ): Promise<PaginatedResult<OrderListItemView>> {
    const where: Prisma.OrderWhereInput = {
      userId,
      ...(query.status ? { status: query.status } : {}),
    };
    return this.paginatedList(where, query.page, query.limit);
  }

  /**
   * W10 hardening (P0) — GET /admin/customers/:id's "recent orders" panel
   * used to call `listOrdersForUser` above directly, which scopes by
   * `userId` alone (correct for that method's OWN customer-facing caller,
   * where a user only ever has one identity). Reused unmodified from an
   * admin context it would leak a customer's order history with every
   * OTHER tenant they've ever shopped at, onto THIS tenant's admin
   * dashboard. This tenant-scoped sibling is for admin callers only.
   */
  async adminListOrdersForCustomer(
    tenantContext: TenantContext,
    userId: string,
    query: { page: number; limit: number },
  ): Promise<PaginatedResult<OrderListItemView>> {
    const where: Prisma.OrderWhereInput = {
      userId,
      tenantId: tenantContext.tenantId,
    };
    return this.paginatedList(where, query.page, query.limit);
  }

  async getOrderDetailForUser(
    userId: string,
    orderId: string,
  ): Promise<OrderDetailView> {
    const order = await this.findOrderDetailOrThrow(orderId);
    this.assertOwnedBy(order, userId);
    return this.toDetailView(order);
  }

  /**
   * Not in §20's frozen contract (no `POST /orders/:id/cancel` row there,
   * and §14's state diagram only ever labels CANCELLED transitions "admin
   * cancels") — implemented anyway per this phase's explicit instruction,
   * as a deliberate extension. Flagged in the completion report rather
   * than silently added.
   */
  async cancelOrder(
    userId: string,
    orderId: string,
    dto: CancelOrderDto,
  ): Promise<OrderDetailView> {
    const order = await this.findOrderOrThrow(orderId);
    this.assertOwnedBy(order, userId);

    if (order.status === OrderStatus.CANCELLED) {
      // Idempotent: already cancelled, no duplicate side effects (§20's
      // CAS-idempotent convention applied here too).
      return this.getOrderDetailForUser(userId, orderId);
    }
    assertTransitionAllowed(order.status, OrderStatus.CANCELLED);

    await this.performCancellation(
      order,
      { role: Role.CUSTOMER, actorId: userId },
      dto.reason,
    );
    return this.getOrderDetailForUser(userId, orderId);
  }

  // ─── Admin-facing (GET/PATCH /admin/orders[/:id], PATCH .../status) ───────

  /**
   * W10 hardening (P0) — this list, adminGetOrderDetail, and
   * adminRecentOrders below were all unconditionally global (no
   * `where.tenantId` at all): any tenant with `orders:read` could browse
   * and page through every OTHER tenant's full order history, including
   * customer PII (shipping name/address/phone) and financial totals.
   */
  async adminListOrders(
    tenantContext: TenantContext,
    query: ListAdminOrdersQueryDto,
  ): Promise<PaginatedResult<OrderListItemView>> {
    const where: Prisma.OrderWhereInput = {
      tenantId: tenantContext.tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.photoReview ? photoReviewWhere(query.photoReview) : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            createdAt: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
        : {}),
    };
    return this.paginatedList(where, query.page, query.limit);
  }

  async adminGetOrderDetail(
    tenantContext: TenantContext,
    orderId: string,
  ): Promise<OrderDetailView> {
    const order = await this.findOrderDetailOrThrow(orderId);
    assertObjectInTenant(order, tenantContext.tenantId);
    return this.toDetailView(order);
  }

  /**
   * GET /admin/dashboard's recent-orders panel (§19, "minimal — no
   * charts"). Same view assembly as the paginated admin/customer lists —
   * one findMany, no separate count query since the dashboard has no
   * pagination to report.
   */
  async adminRecentOrders(
    tenantContext: TenantContext,
    limit: number,
  ): Promise<OrderListItemView[]> {
    const rows = await this.prisma.order.findMany({
      where: { tenantId: tenantContext.tenantId },
      include: ORDER_LIST_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((row) => this.toListItemView(row));
  }

  /**
   * §20: "Already-applied transition → 200; illegal → 409." Cancelling an
   * order with a captured payment flags it for manual refund (see
   * performCancellation) rather than calling Razorpay — same "record
   * only, refund processed manually in the Razorpay dashboard" semantics
   * §13.L already specifies for a direct admin transition to REFUNDED.
   */
  async adminTransitionStatus(
    tenantContext: TenantContext,
    admin: AuthenticatedUser,
    orderId: string,
    dto: UpdateOrderStatusDto,
  ): Promise<OrderDetailView> {
    const order = await this.findOrderOrThrow(orderId);
    // W10 hardening (P0) — this lookup was, until now, global: any tenant
    // with `orders:transition` could cancel/refund/transition ANY other
    // tenant's order by id, and the resulting TenantAuditLog row would be
    // written under the ACTOR's tenant, not the order's own.
    assertObjectInTenant(order, tenantContext.tenantId);

    if (order.status === dto.status) {
      return this.adminGetOrderDetail(tenantContext, orderId);
    }
    assertTransitionAllowed(order.status, dto.status);
    if (dto.status === OrderStatus.IN_PRODUCTION) {
      await this.assertPhotosReadyForProduction(order.id);
    }

    const actor: Actor = { role: Role.ADMIN, actorId: admin.id };
    const tenantAudit: TenantAuditContext = { tenantContext, actor: admin };
    if (dto.status === OrderStatus.CANCELLED) {
      await this.performCancellation(order, actor, dto.reason, tenantAudit);
    } else if (dto.status === OrderStatus.REFUNDED) {
      await this.performRefundRecording(order, actor, dto.reason, tenantAudit);
    } else {
      await this.prisma.$transaction(async (tx) => {
        await this.transitionOrderWithHistory(
          tx,
          order,
          dto.status,
          actor,
          dto.reason,
        );
        const attribution = await resolveTenantAuditActor(
          tx,
          tenantContext,
          admin,
        );
        await this.auditService.logTenantAction(tx, {
          tenantId: tenantContext.tenantId,
          ...attribution,
          action: 'order.status_change',
          targetType: 'Order',
          targetId: order.id,
          metadata: {
            fromStatus: order.status,
            toStatus: dto.status,
            orderTenantId: order.tenantId,
          },
        });
      });
    }
    return this.adminGetOrderDetail(tenantContext, orderId);
  }

  // ─── Photo review ───────────────────────────────────────────────────────

  /** Refuses to start production while a photo is unapproved — but only
   * when the gate is switched on (PHOTO_REVIEW_GATE=enforced). */
  private async assertPhotosReadyForProduction(orderId: string): Promise<void> {
    if (!isPhotoReviewGateEnforced()) return;
    const open = await this.prisma.orderItemCustomization.count({
      where: {
        orderItem: { orderId },
        uploadedFileId: { not: null },
        reviewStatus: {
          in: [PhotoReviewStatus.PENDING, PhotoReviewStatus.CHANGES_REQUESTED],
        },
      },
    });
    if (open > 0) {
      throw new ConflictException(PHOTO_REVIEW_BLOCKS_PRODUCTION_MESSAGE);
    }
  }

  /**
   * Approve a customer's photo, or ask for a new one. Only while the order is
   * PAID or CONFIRMED (once production has started the photo is final).
   * Repeating the same decision is a no-op, so a double click is safe.
   * Notifying the customer is a later phase; the decision is audit-logged.
   */
  async adminReviewPhoto(
    tenantContext: TenantContext,
    admin: AuthenticatedUser,
    orderId: string,
    customizationId: string,
    dto: ReviewPhotoDto,
  ): Promise<{
    id: string;
    reviewStatus: PhotoReviewStatus;
    reviewNote: string | null;
    reviewedAt: Date;
    /** True when an email to the customer was queued. False when there was
     * nothing to send to (a phone-only customer has no email) or the
     * decision was an approval. */
    notified: boolean;
  }> {
    const order = await this.findOrderOrThrow(orderId);
    assertObjectInTenant(order, tenantContext.tenantId);
    if (
      order.status !== OrderStatus.PAID &&
      order.status !== OrderStatus.CONFIRMED
    ) {
      throw new ConflictException(
        'Photos can only be reviewed while the order is paid and not yet in production.',
      );
    }

    const customization = await this.prisma.orderItemCustomization.findFirst({
      where: {
        id: customizationId,
        tenantId: tenantContext.tenantId,
        orderItem: { orderId },
        uploadedFileId: { not: null },
      },
    });
    if (!customization) {
      throw new NotFoundException('Photo not found on this order');
    }

    const target =
      dto.decision === 'APPROVE'
        ? PhotoReviewStatus.APPROVED
        : PhotoReviewStatus.CHANGES_REQUESTED;
    const note =
      target === PhotoReviewStatus.APPROVED ? null : (dto.note ?? null);

    if (
      customization.reviewStatus === target &&
      customization.reviewNote === note &&
      customization.reviewedAt
    ) {
      return {
        id: customization.id,
        reviewStatus: target,
        reviewNote: note,
        reviewedAt: customization.reviewedAt,
        notified: false,
      };
    }

    const reviewedAt = new Date();
    let notified = false;
    await this.prisma.$transaction(async (tx) => {
      await tx.orderItemCustomization.update({
        where: { id: customization.id },
        data: {
          reviewStatus: target,
          reviewNote: note,
          reviewedAt,
          reviewedByUserId: admin.id,
        },
      });
      const attribution = await resolveTenantAuditActor(
        tx,
        tenantContext,
        admin,
      );
      await this.auditService.logTenantAction(tx, {
        tenantId: tenantContext.tenantId,
        ...attribution,
        action: 'order.photo_review',
        targetType: 'Order',
        targetId: order.id,
        metadata: {
          customizationId: customization.id,
          fromStatus: customization.reviewStatus,
          toStatus: target,
        },
      });

      if (target === PhotoReviewStatus.CHANGES_REQUESTED && note) {
        // Email only when the customer has an address: phone-only (OTP)
        // customers have none, and queuing for them would just fail in the
        // poller. They still see the request on their order page.
        const customer = await tx.user.findUnique({
          where: { id: order.userId },
          select: { email: true },
        });
        if (customer?.email) {
          const base = process.env.FRONTEND_URL?.replace(/\/+$/, '');
          await this.notificationsService.enqueueOutboxEvent(tx, {
            eventType: 'ORDER_STATUS_CHANGED',
            aggregateType: 'Order',
            aggregateId: order.id,
            eventKey: `PHOTO_CHANGES_REQUESTED:${customization.id}:${reviewedAt.toISOString()}`,
            payload: {
              kind: 'PHOTO_CHANGES_REQUESTED',
              orderId: order.id,
              orderNumber: order.orderNumber,
              userId: order.userId,
              email: customer.email,
              note,
              ...(base ? { orderLink: `${base}/orders/${order.id}` } : {}),
            },
          });
          notified = true;
        }
      }
    });

    return {
      id: customization.id,
      reviewStatus: target,
      reviewNote: note,
      reviewedAt,
      notified,
    };
  }

  /**
   * The customer's answer to "we need a new photo": swap in a freshly
   * uploaded file and put the photo back in the review queue. Owner only;
   * only while the admin has asked for a change and the order has not gone
   * into production. The new file must be one this customer uploaded for
   * this store.
   */
  async replaceCustomizationPhoto(
    userId: string,
    orderId: string,
    customizationId: string,
    uploadedFileId: string,
  ): Promise<{ id: string; reviewStatus: PhotoReviewStatus }> {
    const order = await this.findOrderOrThrow(orderId);
    this.assertOwnedBy(order, userId);
    if (
      order.status !== OrderStatus.PAID &&
      order.status !== OrderStatus.CONFIRMED
    ) {
      throw new ConflictException(
        'The photo can no longer be changed for this order.',
      );
    }

    const customization = await this.prisma.orderItemCustomization.findFirst({
      where: {
        id: customizationId,
        tenantId: order.tenantId,
        orderItem: { orderId },
        uploadedFileId: { not: null },
      },
    });
    if (!customization) {
      throw new NotFoundException('Photo not found on this order');
    }
    if (customization.reviewStatus !== PhotoReviewStatus.CHANGES_REQUESTED) {
      throw new ConflictException(
        'A new photo has not been requested for this order.',
      );
    }

    const file = await this.prisma.uploadedFile.findFirst({
      where: {
        id: uploadedFileId,
        uploadedByUserId: userId,
        tenantId: order.tenantId,
      },
      select: { id: true },
    });
    if (!file) {
      throw new NotFoundException('Uploaded file not found');
    }

    await this.prisma.orderItemCustomization.update({
      where: { id: customization.id },
      data: {
        uploadedFileId: file.id,
        reviewStatus: PhotoReviewStatus.PENDING,
        reviewNote: null,
        reviewedAt: null,
        reviewedByUserId: null,
      },
    });
    return { id: customization.id, reviewStatus: PhotoReviewStatus.PENDING };
  }

  // ─── Cancellation + manual-refund flagging ─────────────────────────────

  /**
   * §12.5 as originally frozen: "no in-app refund-initiation API in MVP."
   * Cancelling an order that had a captured payment does NOT call
   * Razorpay — it flags the refund for manual processing by writing a
   * `Refund` row with status PENDING and no `razorpayRefundId` (the
   * existing model already fits this exactly: "owed, not yet processed
   * via our API" — no separate boolean needed anywhere). That row is what
   * makes `needsManualRefund` true in both GET /orders/:id and GET
   * /admin/orders[/:id] (see toListItemView/toDetailView), so ops can spot
   * it and action the refund by hand in the Razorpay dashboard. Everything
   * (Refund row + order CAS + history + outbox) commits in one
   * transaction — no external call is interleaved anymore, so unlike
   * Phase 6's payment flows there's nothing that has to sit outside it.
   */
  private async performCancellation(
    order: Order,
    actor: Actor,
    reason: string | undefined,
    tenantAudit?: TenantAuditContext,
  ): Promise<void> {
    const capturedAttempt = await this.prisma.paymentAttempt.findFirst({
      where: { orderId: order.id, status: PaymentAttemptStatus.CAPTURED },
    });
    const needsManualRefund = orderNeedsRefund(capturedAttempt);

    await this.prisma.$transaction(async (tx) => {
      if (needsManualRefund) {
        await tx.refund.create({
          data: {
            paymentAttemptId: capturedAttempt!.id,
            amountPaise: capturedAttempt!.amountPaise,
            status: RefundStatus.PENDING,
            reason: reason ?? null,
            // Derived from the order being cancelled — never a
            // client-supplied value (Phase 4 W7 / P4-D2).
            tenantId: order.tenantId,
          },
        });
      }
      if (
        order.status === OrderStatus.PENDING_PAYMENT ||
        order.status === OrderStatus.PAYMENT_FAILED
      ) {
        await tx.paymentAttempt.updateMany({
          where: {
            orderId: order.id,
            status: PaymentAttemptStatus.INITIATED,
          },
          data: { status: PaymentAttemptStatus.ABANDONED },
        });
        if (order.couponId) {
          await tx.couponUsage.deleteMany({ where: { orderId: order.id } });
          await tx.coupon.updateMany({
            where: { id: order.couponId, usedCount: { gt: 0 } },
            data: { usedCount: { decrement: 1 } },
          });
        }
      }
      await this.transitionOrderWithHistory(
        tx,
        order,
        OrderStatus.CANCELLED,
        actor,
        reason,
        needsManualRefund,
      );
      // Phase 5 W8 — ADMIN-initiated cancellation only (see
      // TenantAuditContext's own doc comment: absent for the
      // customer-facing cancelOrder path, which shares this method).
      if (tenantAudit) {
        const attribution = await resolveTenantAuditActor(
          tx,
          tenantAudit.tenantContext,
          tenantAudit.actor,
        );
        await this.auditService.logTenantAction(tx, {
          tenantId: tenantAudit.tenantContext.tenantId,
          ...attribution,
          action: 'order.cancel',
          targetType: 'Order',
          targetId: order.id,
          metadata: {
            reason: reason ?? null,
            needsManualRefund,
            orderTenantId: order.tenantId,
          },
        });
      }
    });
  }

  /**
   * §13.L / §32: "no in-app refund-initiation API in MVP" — a direct admin
   * transition to REFUNDED only *records* that a refund already happened
   * manually in the Razorpay dashboard. Closes the loop performCancellation
   * opened: whichever Refund row it left PENDING for this order is marked
   * PROCESSED here, in the same transaction as the order CAS + history +
   * outbox. `updateMany` is a safe no-op if there isn't one — a direct
   * PAID/CONFIRMED/IN_PRODUCTION/SHIPPED/DELIVERED -> REFUNDED transition
   * with no prior cancellation never had a PENDING Refund row to begin
   * with, and this phase doesn't invent one (no in-app refund creation).
   */
  private async performRefundRecording(
    order: Order,
    actor: Actor,
    reason: string | undefined,
    tenantAudit?: TenantAuditContext,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.refund.updateMany({
        where: {
          status: RefundStatus.PENDING,
          paymentAttempt: { orderId: order.id },
        },
        data: { status: RefundStatus.PROCESSED },
      });
      await this.transitionOrderWithHistory(
        tx,
        order,
        OrderStatus.REFUNDED,
        actor,
        reason,
      );
      // Phase 5 W8 — this path is only ever reached from
      // adminTransitionStatus (no customer-facing route ever transitions
      // directly to REFUNDED), but `tenantAudit` is still checked
      // defensively rather than assumed, for the same reason
      // performCancellation does.
      if (tenantAudit) {
        const attribution = await resolveTenantAuditActor(
          tx,
          tenantAudit.tenantContext,
          tenantAudit.actor,
        );
        await this.auditService.logTenantAction(tx, {
          tenantId: tenantAudit.tenantContext.tenantId,
          ...attribution,
          action: 'order.refund_record',
          targetType: 'Order',
          targetId: order.id,
          metadata: { reason: reason ?? null, orderTenantId: order.tenantId },
        });
      }
    });
  }

  /**
   * CAS + history + outbox, via the existing state machine (§14) —
   * every transition, customer or admin, goes through this one place.
   * `cas.count !== 1` (lost a race — someone else already transitioned
   * it) is a safe no-op, not an error, matching Phase 5/6's convention.
   * `refundPending` only ever comes from performCancellation — it flows
   * into the history note and the outbox payload so the notification
   * email can say a refund is being processed by our team, never that one
   * was automatically triggered.
   */
  private async transitionOrderWithHistory(
    tx: Prisma.TransactionClient,
    order: Order,
    to: OrderStatus,
    actor: Actor,
    reason: string | undefined,
    refundPending = false,
  ): Promise<void> {
    assertTransitionAllowed(order.status, to);

    // The delivery pin is only needed until the parcel is handed over; once the
    // order is delivered, cancelled or refunded it is erased in the same update.
    const pinNoLongerNeeded =
      to === OrderStatus.DELIVERED ||
      to === OrderStatus.CANCELLED ||
      to === OrderStatus.REFUNDED;
    const cas = await tx.order.updateMany({
      where: { id: order.id, status: order.status },
      data: {
        status: to,
        ...(pinNoLongerNeeded
          ? { shippingLatitude: null, shippingLongitude: null }
          : {}),
      },
    });
    if (cas.count !== 1) {
      return;
    }

    const defaultNote = refundPending
      ? `Order ${to.toLowerCase()} — refund pending manual processing`
      : `Order ${to.toLowerCase()}`;
    const note = `[${actor.role}] ${reason?.trim() || defaultNote}`;
    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        fromStatus: order.status,
        toStatus: to,
        changedByUserId: actor.actorId,
        note,
        // Derived from the order being transitioned — never a
        // client-supplied value (Phase 4 W7 / P4-D2).
        tenantId: order.tenantId,
      },
    });

    // §12.2: denormalized snapshot captured at insert time, including the
    // recipient email — "the processor never re-queries business tables."
    const user = await tx.user.findUniqueOrThrow({
      where: { id: order.userId },
      select: { email: true },
    });
    await this.notificationsService.enqueueOutboxEvent(tx, {
      eventType: 'ORDER_STATUS_CHANGED',
      aggregateType: 'Order',
      aggregateId: order.id,
      eventKey: `ORDER_STATUS_CHANGED:${order.id}:${to}`,
      payload: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        userId: order.userId,
        email: user.email,
        fromStatus: order.status,
        toStatus: to,
        ...(refundPending ? { refundPending: true } : {}),
      },
    });
  }

  // ─── Shared read helpers ────────────────────────────────────────────────

  private async paginatedList(
    where: Prisma.OrderWhereInput,
    page: number,
    limit: number,
  ): Promise<PaginatedResult<OrderListItemView>> {
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: ORDER_LIST_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.order.count({ where }),
    ]);
    return {
      items: rows.map((row) => this.toListItemView(row)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  private async findOrderOrThrow(orderId: string): Promise<Order> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  private async findOrderDetailOrThrow(
    orderId: string,
  ): Promise<OrderWithDetail> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: ORDER_DETAIL_INCLUDE,
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  /** 403, not 404, for a wrong-owner access — explicit choice for this
   * phase's customer-facing routes (distinct from other modules' "identical
   * to nonexistent" convention elsewhere in this codebase). */
  private assertOwnedBy(order: { userId: string }, userId: string): void {
    if (order.userId !== userId) {
      throw new ForbiddenException('You do not have access to this order');
    }
  }

  // ─── View assembly ──────────────────────────────────────────────────────

  private toListItemView(order: OrderListRow): OrderListItemView {
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      total: paiseToDecimalString(decimalToPaise(order.total)),
      currency: order.currency,
      itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
      needsManualRefund: order.paymentAttempts.some(
        (pa) => pa.refunds.length > 0,
      ),
      recipientName: order.shippingRecipientName,
      photoReview: summarisePhotoReview(
        order.items.flatMap((item) =>
          item.customizations.map((c) => c.reviewStatus),
        ),
        order.status,
      ),
      createdAt: order.createdAt,
    };
  }

  private toDetailView(order: OrderWithDetail): OrderDetailView {
    const statusHistory: OrderStatusHistoryView[] = order.statusHistory.map(
      (h) => ({
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        changedByUserId: h.changedByUserId,
        note: h.note,
        createdAt: h.createdAt,
      }),
    );

    const paymentAttempts: PaymentAttemptView[] = order.paymentAttempts.map(
      (attempt) => {
        const refunds: RefundView[] = attempt.refunds.map((refund) => ({
          id: refund.id,
          amountPaise: refund.amountPaise.toString(),
          status: refund.status,
          reason: refund.reason,
          createdAt: refund.createdAt,
        }));
        return {
          id: attempt.id,
          status: attempt.status,
          amountPaise: attempt.amountPaise.toString(),
          method: attempt.method,
          failureCode: attempt.failureCode,
          failureReason: attempt.failureReason,
          createdAt: attempt.createdAt,
          capturedAt: attempt.capturedAt,
          refunds,
        };
      },
    );

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      subtotal: paiseToDecimalString(decimalToPaise(order.subtotal)),
      total: paiseToDecimalString(decimalToPaise(order.total)),
      shippingFee: paiseToDecimalString(decimalToPaise(order.shippingFee)),
      discountAmount: paiseToDecimalString(
        decimalToPaise(order.discountAmount),
      ),
      taxableAmount: paiseToDecimalString(decimalToPaise(order.taxableAmount)),
      taxAmount: paiseToDecimalString(decimalToPaise(order.taxAmount)),
      taxMode: order.taxMode,
      taxRatePercent: order.taxRateSnapshot
        ? new Prisma.Decimal(order.taxRateSnapshot).mul(100).toFixed(2)
        : null,
      couponCode: order.couponCode,
      currency: order.currency,
      itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
      needsManualRefund: order.paymentAttempts.some((attempt) =>
        attempt.refunds.some(
          (refund) => refund.status === RefundStatus.PENDING,
        ),
      ),
      recipientName: order.shippingRecipientName,
      photoReview: summarisePhotoReview(
        order.items.flatMap((item) =>
          item.customizations
            .filter((c) => c.uploadedFileId !== null)
            .map((c) => c.reviewStatus),
        ),
        order.status,
      ),
      shippingRecipientName: order.shippingRecipientName,
      shippingPhone: order.shippingPhone,
      shippingAddressLine1: order.shippingAddressLine1,
      shippingAddressLine2: order.shippingAddressLine2,
      shippingCity: order.shippingCity,
      shippingState: order.shippingState,
      shippingPostalCode: order.shippingPostalCode,
      shippingCountry: order.shippingCountry,
      deliveryPin:
        order.shippingLatitude !== null && order.shippingLongitude !== null
          ? {
              latitude: order.shippingLatitude,
              longitude: order.shippingLongitude,
            }
          : null,
      createdAt: order.createdAt,
      items: order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.productNameSnapshot,
        variantLabel: item.variantLabelSnapshot,
        unitPrice: paiseToDecimalString(decimalToPaise(item.unitPriceSnapshot)),
        quantity: item.quantity,
        lineTotal: paiseToDecimalString(decimalToPaise(item.lineTotal)),
        customizations: item.customizations.map((c) => ({
          id: c.id,
          fieldLabel: c.fieldLabelSnapshot,
          textValue: c.textValue,
          uploadedFileId: c.uploadedFileId,
          reviewStatus: c.reviewStatus,
          reviewNote: c.reviewNote,
        })),
      })),
      statusHistory,
      paymentAttempts,
    };
  }
}
