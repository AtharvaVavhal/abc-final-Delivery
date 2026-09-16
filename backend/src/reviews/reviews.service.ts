import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Review, ReviewStatus } from '@prisma/client';
import { PrismaService } from '../common/database/prisma.service';
import { PaginatedResult } from '../common/types/api-response.interface';
import { AuditService } from '../common/audit/audit.service';
import { resolveTenantAuditActor } from '../common/audit/tenant-actor-attribution';
import { assertObjectInTenant } from '../common/tenant/object-auth';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { TenantContext } from '../common/tenant/tenant-context';
import { OrdersService } from '../orders/orders.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { UpdateReviewStatusDto } from './dto/update-review-status.dto';
import { ListProductReviewsQueryDto } from './dto/list-product-reviews-query.dto';
import { ReviewView } from './dto/review-view.interface';

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
    private readonly auditService: AuditService,
  ) {}

  // ─── POST /reviews (§1.1/R1 — verified-purchase gated) ─────────────────

  /**
   * The verified-purchase anchor is resolved here, server-side, from the
   * caller's own id — never accepted as a client-supplied field (PHASE-10-
   * PROPOSAL.md §1.1). `orderItemId` (not `orderId`) matters because a
   * single order can contain items for several products; anchoring on the
   * order alone would let a review of Product B piggyback on an order that
   * only actually contained Product A. Any qualifying item is sufficient —
   * which one doesn't matter, since it's the same product either way.
   */
  async createReview(
    userId: string,
    dto: CreateReviewDto,
  ): Promise<ReviewView> {
    return this.prisma.$transaction(async (tx) => {
      const eligible =
        await this.ordersService.findDeliveredOrderItemForProduct(
          tx,
          userId,
          dto.productId,
        );
      if (!eligible) {
        throw new ConflictException(
          'You can only review a product from an order that has been delivered to you',
        );
      }

      let created: Review;
      try {
        created = await tx.review.create({
          data: {
            productId: dto.productId,
            userId,
            orderItemId: eligible.id,
            rating: dto.rating,
            bodyText: dto.bodyText ?? null,
            // Derived from the verified-purchase anchor itself — never a
            // client-supplied value, and guaranteed consistent with the
            // OrderItem this review is anchored to (Phase 4 W7 / P4-D2).
            tenantId: eligible.tenantId,
          },
        });
      } catch (err) {
        this.mapUniqueConstraintError(
          err,
          'You have already reviewed this product',
        );
      }

      await this.recomputeProductRating(tx, dto.productId);
      return this.toView(created);
    });
  }

  // ─── PATCH /reviews/:id (author only) ───────────────────────────────────

  async updateReview(
    userId: string,
    reviewId: string,
    dto: UpdateReviewDto,
  ): Promise<ReviewView> {
    return this.prisma.$transaction(async (tx) => {
      const review = await this.getReviewOwnedByOrThrow(tx, reviewId, userId);

      const updated = await tx.review.update({
        where: { id: reviewId },
        data: {
          ...(dto.rating !== undefined ? { rating: dto.rating } : {}),
          ...(dto.bodyText !== undefined ? { bodyText: dto.bodyText } : {}),
        },
      });

      await this.recomputeProductRating(tx, review.productId);
      return this.toView(updated);
    });
  }

  // ─── DELETE /reviews/:id (author only, soft — §1.1/R4) ──────────────────

  /**
   * Never a hard delete — sets status=REMOVED, same "state transition, not
   * deletion" philosophy this schema already applies to orders/products.
   * Idempotent: removing an already-REMOVED review just re-asserts the
   * same state rather than erroring, consistent with this codebase's
   * general double-click-safe CAS conventions.
   */
  async removeReview(userId: string, reviewId: string): Promise<ReviewView> {
    return this.prisma.$transaction(async (tx) => {
      const review = await this.getReviewOwnedByOrThrow(tx, reviewId, userId);

      const updated = await tx.review.update({
        where: { id: reviewId },
        data: { status: ReviewStatus.REMOVED },
      });

      await this.recomputeProductRating(tx, review.productId);
      return this.toView(updated);
    });
  }

  // ─── PATCH /admin/reviews/:id/status (admin only, moderation) ──────────

  /**
   * No transition graph (§14-style) to enforce — unlike order status, any
   * ReviewStatus to any ReviewStatus is a valid moderation action.
   */
  async adminUpdateStatus(
    tenantContext: TenantContext,
    actor: AuthenticatedUser,
    reviewId: string,
    dto: UpdateReviewStatusDto,
  ): Promise<ReviewView> {
    return this.prisma.$transaction(async (tx) => {
      const review = await tx.review.findUnique({ where: { id: reviewId } });
      if (!review) {
        throw new NotFoundException('Review not found');
      }
      // W10 hardening (P0) — this lookup was, until now, global: any
      // tenant with `reviews:moderate` could approve/reject ANY other
      // tenant's product reviews by id.
      assertObjectInTenant(review, tenantContext.tenantId);

      const updated = await tx.review.update({
        where: { id: reviewId },
        data: { status: dto.status },
      });

      await this.recomputeProductRating(tx, review.productId);

      const attribution = await resolveTenantAuditActor(
        tx,
        tenantContext,
        actor,
      );
      await this.auditService.logTenantAction(tx, {
        tenantId: tenantContext.tenantId,
        ...attribution,
        action: 'review.moderate',
        targetType: 'Review',
        targetId: reviewId,
        metadata: { fromStatus: review.status, toStatus: dto.status },
      });

      return this.toView(updated);
    });
  }

  // ─── GET /products/:id/reviews (public, PUBLISHED only) ─────────────────

  async listForProduct(
    tenantId: string,
    productId: string,
    query: ListProductReviewsQueryDto,
  ): Promise<PaginatedResult<ReviewView>> {
    const where: Prisma.ReviewWhereInput = {
      tenantId,
      productId,
      status: ReviewStatus.PUBLISHED,
    };
    const [rows, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.review.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toView(row)),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  // ─── Shared helpers ──────────────────────────────────────────────────────

  private async getReviewOwnedByOrThrow(
    tx: Prisma.TransactionClient,
    reviewId: string,
    userId: string,
  ): Promise<Review> {
    const review = await tx.review.findUnique({ where: { id: reviewId } });
    if (!review) {
      throw new NotFoundException('Review not found');
    }
    if (review.userId !== userId) {
      // Ownership re-checked explicitly, never inferred from the id alone
      // (§24 invariant 2/12) — a review id is not secret, but editing
      // someone else's review must fail regardless.
      throw new ForbiddenException('You can only manage your own review');
    }
    return review;
  }

  /**
   * Denormalized Product.avgRating/reviewCount (§1.1/R7) — recomputed via a
   * scoped re-aggregate inside the same transaction as any review write,
   * never read-time computed. The product row is locked FIRST, before the
   * aggregate SELECT: without that, two concurrent review writes for the
   * SAME product could each read a stale aggregate (missing each other's
   * not-yet-committed row), and whichever commits second would overwrite
   * the first's correct values with a stale one — a classic read-then-
   * write lost update. Locking first serializes the recompute, same
   * pattern as the cart/checkout row locks elsewhere in this codebase.
   */
  private async recomputeProductRating(
    tx: Prisma.TransactionClient,
    productId: string,
  ): Promise<void> {
    await tx.$queryRaw`SELECT id FROM products WHERE id = ${productId} FOR UPDATE`;

    const agg = await tx.review.aggregate({
      where: { productId, status: ReviewStatus.PUBLISHED },
      _avg: { rating: true },
      _count: { _all: true },
    });

    await tx.product.update({
      where: { id: productId },
      data: {
        reviewCount: agg._count._all,
        avgRating:
          agg._count._all > 0 && agg._avg.rating !== null
            ? new Prisma.Decimal(agg._avg.rating.toFixed(2))
            : null,
      },
    });
  }

  private mapUniqueConstraintError(err: unknown, message: string): never {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      throw new ConflictException(message);
    }
    throw err as Error;
  }

  private toView(review: Review): ReviewView {
    return {
      id: review.id,
      productId: review.productId,
      userId: review.userId,
      rating: review.rating,
      bodyText: review.bodyText,
      status: review.status,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
    };
  }
}
