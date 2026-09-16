import { Module } from '@nestjs/common';
import { AuditModule } from '../common/audit/audit.module';
import { OrdersModule } from '../orders/orders.module';
import { StorefrontTenantResolver } from '../common/tenant/storefront-tenant.resolver';
import { ReviewsController } from './reviews.controller';
import { ProductReviewsController } from './product-reviews.controller';
import { ReviewsService } from './reviews.service';

/**
 * New top-level module, NOT a `products/` subfolder (unlike categories/
 * variants/customization-fields, which are sub-concerns of the products
 * aggregate). Reviews needs the verified-purchase check (§1.1/R1), which
 * needs order/order-item data — but `OrdersModule` already imports
 * `ProductsModule` (products.module.ts: "line-item snapshot"). Nesting
 * Reviews inside `ProductsModule` would require `ProductsModule` to import
 * `OrdersModule` too, creating a direct cycle (`ProductsModule ->
 * OrdersModule -> ProductsModule`) — confirmed against the actual current
 * orders.module.ts/products.module.ts imports, not assumed from the
 * proposal alone (PHASE-10-PROPOSAL.md §1.3).
 *
 * Depends on: orders — `ReviewsService` injects `OrdersService` and calls
 * its `findDeliveredOrderItemForProduct(tx, ...)` for the verified-purchase
 * check, the same "route a cross-module read through the owning module's
 * service" convention `checkout.service.ts` already follows for
 * `generateOrderNumber`. Does NOT import `ProductsModule` — recomputing the
 * denormalized `avgRating`/`reviewCount` columns is a direct `products`
 * table write via the shared `PrismaService` (same as `admin.service.ts`'s
 * direct `User`/`Order` writes for dashboard aggregation), not a call into
 * `ProductsService`'s business logic.
 */
@Module({
  imports: [OrdersModule, AuditModule],
  controllers: [ReviewsController, ProductReviewsController],
  providers: [ReviewsService, StorefrontTenantResolver],
  exports: [ReviewsService],
})
export class ReviewsModule {}
