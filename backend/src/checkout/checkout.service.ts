import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../common/database/prisma.service';
import { assertTenantActive } from '../common/tenant/tenant-lifecycle';
import { resolvePrimaryStoreId } from '../common/tenant/primary-store';
import {
  decimalToPaise,
  paiseToDecimalString,
} from '../cart/pricing/money.util';
import { validateCustomizationFieldShape } from '../products/customizations/customization-validation.util';
import { OrdersService } from '../orders/orders.service';
import { CouponsService } from '../coupons/coupons.service';
import { IdempotencyService } from './idempotency/idempotency.service';
import { OrderLinePricing, PricingService } from './pricing/pricing.service';
import { TaxService } from './tax/tax.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { CheckoutPreviewView, OrderView } from './dto/order-view.interface';
import { LimitEnforcementService } from '../limits/limit-enforcement.service';
import { SubscriptionService } from '../subscriptions/subscription.service';
import { deriveBillingPeriodIdentifier } from '../usage/usage-period';

const CHECKOUT_ENDPOINT_ID = 'POST /checkout/orders';
const SHIPPING_FEE_SETTING_KEY = 'shippingFeeFlat';

/**
 * Phase 7 — Wave B fail-closed correction. Same fixed, non-descriptive
 * 403-message convention `LIMIT_EXCEEDED_MESSAGE`
 * (`limit-enforcement.service.ts`) already establishes, adapted for a
 * `ServiceUnavailableException` here — never includes the tenant id or
 * subscription state, and is deliberately NOT `limit_exceeded`: this
 * signals "the billing period needed to enforce orders_per_month is not
 * yet available", never "the tenant's quota is exhausted" (which may not
 * even be true).
 */
const BILLING_PERIOD_UNAVAILABLE_MESSAGE = 'billing_period_unavailable';

/**
 * Mirrors cart's PLATFORM_DEFAULT_MAX_QUANTITY (§11) — duplicated locally
 * rather than imported from cart/, since only money.util.ts is sanctioned
 * for cross-import from the cart module in this phase.
 */
const PLATFORM_DEFAULT_MAX_QUANTITY = 1000;

const CHECKOUT_CART_ITEM_INCLUDE = {
  product: true,
  variant: true,
  customizations: { include: { customizationField: true } },
} satisfies Prisma.CartItemInclude;

type CheckoutCartItem = Prisma.CartItemGetPayload<{
  include: typeof CHECKOUT_CART_ITEM_INCLUDE;
}>;

const ORDER_DETAIL_INCLUDE = {
  items: {
    include: { customizations: true },
    orderBy: { id: 'asc' as const },
  },
} satisfies Prisma.OrderInclude;

type OrderWithItems = Prisma.OrderGetPayload<{
  include: typeof ORDER_DETAIL_INCLUDE;
}>;

/** Prisma's default interactive-transaction budget (5s) is too tight for
 * this transaction's full sequence (cart lock, idempotency claim, coupon
 * validation, order/item/customization writes, cart clearing) against the
 * remote Postgres instance's per-round-trip latency — raised the same way
 * `tenant-rls.ts`'s scoped-client transactions already are. */
const CHECKOUT_TRANSACTION_TIMEOUT_MS = 20_000;

/**
 * §17: checkout owns order creation; orders owns the post-creation state
 * machine/history (see completion report for the full reasoning). One
 * Prisma transaction covers the idempotency claim, cart re-validation,
 * pricing, Order/OrderItem/OrderItemCustomization/OrderStatusHistory
 * writes, and cart clearing — §13.G "must not partially commit".
 */
@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
    private readonly idempotencyService: IdempotencyService,
    private readonly pricingService: PricingService,
    private readonly couponsService: CouponsService,
    private readonly taxService: TaxService,
    private readonly limitEnforcementService: LimitEnforcementService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  /**
   * Splits the tax-inclusive goods value (subtotal − discount) into its
   * net + GST components per the current admin tax config, and returns the
   * amount (if any) that a tax-EXCLUSIVE regime would add on top of the
   * existing total. For the default INCLUSIVE / disabled config this is a
   * structural no-op: `taxToAddPaise` is 0, so `total` and the Razorpay
   * amount never change (Phase 13.4 §6).
   */
  private applyTax(computation: ReturnType<TaxService['computeTax']>): {
    taxToAddPaise: bigint;
    orderTaxFields: {
      taxMode: string;
      taxableAmount: string;
      taxAmount: string;
      taxRateSnapshot: string | null;
    };
  } {
    return {
      taxToAddPaise:
        computation.mode === 'EXCLUSIVE' && computation.applied
          ? computation.taxAmountPaise
          : 0n,
      orderTaxFields: {
        taxMode: computation.mode,
        taxableAmount: paiseToDecimalString(computation.taxableAmountPaise),
        taxAmount: paiseToDecimalString(computation.taxAmountPaise),
        taxRateSnapshot: computation.taxRateSnapshot,
      },
    };
  }

  async checkout(
    userId: string,
    dto: CreateOrderDto,
    idempotencyKey: string,
  ): Promise<{ view: OrderView; created: boolean }> {
    // Fast path: a repeat request for an already-completed checkout skips
    // the transaction entirely.
    const existing = await this.idempotencyService.findExisting(idempotencyKey);
    if (existing) {
      if (existing.userId !== userId) {
        // Never confirm/deny another user's key or leak their order.
        throw new ConflictException('Idempotency key already in use');
      }
      if (existing.resultOrderId) {
        return {
          view: await this.loadOrderView(existing.resultOrderId, userId),
          created: false,
        };
      }
      throw new ConflictException(
        'A checkout for this idempotency key is already in progress',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // §13.G: "SELECT cart FOR UPDATE" is the transaction's first step —
      // this is what actually makes #14 (two simultaneous checkout tabs on
      // the same cart, *different* Idempotency-Keys) race-safe. The
      // idempotency claim below only dedupes two requests sharing the same
      // key; without this lock, two concurrent transactions with different
      // keys would both read the same cart items before either created
      // an order. Locking first (rather than after the claim) also means
      // a same-key retry that loses this lock race resumes only after the
      // winner has committed, so the raced-claim lookup below reliably
      // sees the winner's resultOrderId. Cart lines stay until payment is
      // captured so dismissing Razorpay does not empty the bag.
      const [lockedCart] = await tx.$queryRaw<
        { id: string; tenantId: string }[]
      >`
        SELECT id, "tenantId" FROM carts WHERE "userId" = ${userId} FOR UPDATE
      `;
      if (!lockedCart) {
        throw new BadRequestException('Your cart is empty');
      }

      // Phase 5 W4 (SaaS Master Plan §11) — checkout reads the cart's own
      // tenantId directly (an already-loaded parent resource), bypassing
      // StorefrontTenantResolver entirely (see that resolver's own header
      // comment) — so it needs its own lifecycle check. Placed inside this
      // same transaction, right after the cart's FOR UPDATE lock and
      // before any pricing/order-creation work, so a concurrent suspend is
      // seen consistently rather than racing a check made outside the tx.
      await assertTenantActive(
        tx,
        lockedCart.tenantId,
        'This store is currently unavailable',
      );

      // Keep cart items until payment is captured. A dismissed Razorpay
      // modal must not empty the bag. Concurrent checkouts still serialize
      // on this lock; the second waiter resumes the unpaid order instead
      // of creating another.
      const existingUnpaid = await tx.order.findFirst({
        where: {
          userId,
          tenantId: lockedCart.tenantId,
          status: {
            in: [OrderStatus.PENDING_PAYMENT, OrderStatus.PAYMENT_FAILED],
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (existingUnpaid) {
        return { orderId: existingUnpaid.id, created: false };
      }

      const claim = await this.idempotencyService.claim(tx, {
        key: idempotencyKey,
        userId,
        endpoint: CHECKOUT_ENDPOINT_ID,
        // Derived from the cart being checked out — never a
        // client-supplied value (Phase 4 W7 / P4-D2).
        tenantId: lockedCart.tenantId,
      });
      if (!claim) {
        // Lost the race: by the time INSERT...ON CONFLICT returns nothing,
        // Postgres has already blocked-then-unblocked us behind the
        // winning transaction's commit, so its resultOrderId is visible.
        const raced = await tx.idempotencyKey.findUnique({
          where: { key: idempotencyKey },
        });
        if (raced?.resultOrderId && raced.userId === userId) {
          return { orderId: raced.resultOrderId, created: false };
        }
        throw new ConflictException(
          'A checkout for this idempotency key is already in progress',
        );
      }

      const cart = await tx.cart.findUnique({
        where: { id: lockedCart.id },
        include: {
          items: {
            orderBy: { createdAt: 'asc' },
            include: CHECKOUT_CART_ITEM_INCLUDE,
          },
        },
      });
      if (!cart || cart.items.length === 0) {
        throw new BadRequestException('Your cart is empty');
      }

      this.assertItemsCheckoutable(cart.items);

      // Phase 5 W9 (decision D11) — shippingFeeFlat is STORE-owned.
      // `resolvePrimaryStoreId` requires the full `PrismaService` (its D4
      // tenant-scoped client cannot be built from an already-open
      // `Prisma.TransactionClient` — the same limitation
      // `AppSettingService.updateConfigurable` documents), so this one read
      // uses a separate connection (`this.prisma`) rather than `tx`. This
      // does not weaken checkout's atomicity: no checkout-adjacent code
      // path ever mutates `Store.isPrimary`, so there is nothing for this
      // read to race against.
      const storeId = await resolvePrimaryStoreId(this.prisma, cart.tenantId);
      const shippingFeePaise = await this.getShippingFeePaise(tx, storeId);
      const linePricing = cart.items.map((item) => ({
        item,
        pricing: this.priceItem(item),
      }));
      const subtotalPaise = this.pricingService.sumLineTotals(
        linePricing.map((l) => l.pricing),
      );

      // Coupon claim (§2.4/§2.6) — additive: PricingService.computeOrderTotal
      // already accepts an optional discountPaise, populated here for the
      // first time, its signature unchanged. Must run inside this same
      // transaction, after subtotal is known (scope/minOrderValue checks
      // need it) and before computeOrderTotal — a thrown error here (400
      // invalid/expired/scope-mismatched/etc., or 409 usage-limit-exhausted)
      // rolls back the whole transaction, including the idempotency claim
      // already made above, leaving nothing half-claimed for a retry.
      let discountPaise = 0n;
      let finalShippingFeePaise = shippingFeePaise;
      let couponClaim: { couponId: string; couponCode: string } | null = null;
      if (dto.couponCode) {
        const claim = await this.couponsService.validateAndClaim(tx, {
          code: dto.couponCode,
          userId,
          subtotalPaise,
          shippingFeePaise,
          lineItems: linePricing.map(({ item, pricing }) => ({
            categoryId: item.product.categoryId,
            lineTotalPaise: pricing.lineTotalPaise,
          })),
          // Derived from the cart being checked out — never a
          // client-supplied value (Phase 4 W7 / P4-D2; W10 hardening).
          tenantId: cart.tenantId,
        });
        discountPaise = claim.discountPaise;
        finalShippingFeePaise = claim.shippingFeePaise;
        couponClaim = {
          couponId: claim.couponId,
          couponCode: claim.couponCode,
        };
      }

      // Tax split (Phase 13.4). Base is the tax-inclusive goods value.
      // For the default INCLUSIVE/disabled config `taxToAddPaise` is 0 —
      // `total` is byte-for-byte what it was before this phase.
      const taxConfig = await this.taxService.getConfig(cart.tenantId, tx);
      const taxComputation = this.taxService.computeTax(
        subtotalPaise - discountPaise,
        taxConfig,
      );
      const { taxToAddPaise, orderTaxFields } = this.applyTax(taxComputation);

      const totalPaise = this.pricingService.computeOrderTotal({
        subtotalPaise,
        shippingFeePaise: finalShippingFeePaise,
        discountPaise,
        taxToAddPaise,
      });

      const orderNumber = await this.ordersService.generateOrderNumber(tx);

      // Phase 7 — Wave B (orders_per_month enforcement), corrected by the
      // Wave B fail-closed correction below. Same "reservation + resource
      // creation atomic together" placement `ProductsService
      // .createProduct()`'s own `assertLimit()` call already establishes —
      // immediately before the gated resource's own `.create()`, inside
      // this SAME transaction, so a rejected reservation (or a fail-closed
      // throw below) rolls back nothing-yet-created.
      //
      // The billing-period identifier is READ, never invented
      // (docs/saas/DECISIONS.md P7-D1 Part E / Wave A): it is always
      // exactly `Subscription.currentPeriodStart.toISOString()`, resolved
      // via `deriveBillingPeriodIdentifier()` — never
      // `Order.createdAt`, `Subscription.createdAt`, `currentPeriodEnd`, a
      // calendar month, or any other locally-derived value. Read through
      // `SubscriptionService` (never a raw `tx.subscription...` call —
      // `subscription` is one of the six tenant-data-access-guard.spec.ts-
      // restricted models) using THIS transaction's own `tx`, so it sees
      // the same snapshot every other read in this transaction does.
      //
      // A tenant with no confirmed billing period yet (no `Subscription`
      // row at all, or one that has never completed a provider-confirmed
      // activation/renewal — e.g. a `PENDING` subscription, or a legacy/
      // bootstrap-seeded row) has no authoritative period to key this
      // limit on. **FAILS CLOSED**: rather than inventing one (forbidden)
      // or skipping enforcement (rejected — that would make
      // `orders_per_month` silently unlimited for exactly the tenants a
      // finite `BILLING_PERIOD` `PlanLimit`, including the fallback/free
      // plan, is supposed to bind), this throws immediately, before
      // `assertLimit`/`UsageService.reserve` is ever called and before
      // `tx.order.create` below — no Order is created, no `Usage` row is
      // created or incremented for any period, real or invented.
      //
      // `ServiceUnavailableException` (never `ForbiddenException`) —
      // deliberately NOT the same shape as `limit_exceeded`: this is not
      // a claim that the tenant exhausted its quota (it may have room to
      // spare on whichever plan would apply), it is "billing state this
      // operation depends on is not yet available", the same class of
      // outcome `SubscriptionOrchestrationService`'s own provider-
      // timeout/reconciliation paths already return 503 for. A fixed,
      // non-descriptive message — no tenant id, no subscription state —
      // mirrors `LIMIT_EXCEEDED_MESSAGE`'s own convention.
      const subscriptionForPeriod =
        await this.subscriptionService.findSubscriptionForTenant(
          tx,
          cart.tenantId,
        );
      if (!subscriptionForPeriod?.currentPeriodStart) {
        throw new ServiceUnavailableException(
          BILLING_PERIOD_UNAVAILABLE_MESSAGE,
        );
      }
      await this.limitEnforcementService.assertLimit(
        tx,
        cart.tenantId,
        'orders_per_month',
        1,
        deriveBillingPeriodIdentifier(subscriptionForPeriod.currentPeriodStart),
      );

      const createdOrder = await tx.order.create({
        data: {
          orderNumber,
          userId,
          // Derived from the cart being checked out — never a
          // client-supplied value (Phase 4 W7 / P4-D2).
          tenantId: cart.tenantId,
          // Phase 8 (P8-3 architecture spec §6.1) — the same server-resolved
          // `storeId` already computed above (line ~225, via
          // `resolvePrimaryStoreId`) for the shipping-fee lookup, now also
          // persisted onto the Order itself. Confirmed gap the Phase 8
          // Start-Gate Audit identified: this column has existed since
          // Phase 4 W6 but was never written here — `PaymentAccount`
          // resolution (a later P8 stage) needs it to walk
          // Order -> Store -> PaymentAccount. No new resolution mechanism
          // introduced — reuses the exact value already in scope.
          storeId,
          status: OrderStatus.PENDING_PAYMENT,
          subtotal: paiseToDecimalString(subtotalPaise),
          shippingFee: paiseToDecimalString(finalShippingFeePaise),
          total: paiseToDecimalString(totalPaise),
          discountAmount: paiseToDecimalString(discountPaise),
          taxMode: orderTaxFields.taxMode,
          taxableAmount: orderTaxFields.taxableAmount,
          taxAmount: orderTaxFields.taxAmount,
          taxRateSnapshot: orderTaxFields.taxRateSnapshot,
          couponId: couponClaim?.couponId,
          couponCode: couponClaim?.couponCode,
          shippingRecipientName: dto.shippingRecipientName,
          shippingPhone: dto.shippingPhone,
          shippingAddressLine1: dto.shippingAddressLine1,
          shippingAddressLine2: dto.shippingAddressLine2,
          shippingCity: dto.shippingCity,
          shippingState: dto.shippingState,
          shippingPostalCode: dto.shippingPostalCode,
          shippingCountry: dto.shippingCountry,
        },
      });

      // Audit-ledger row (§2.1) — can only be written now that the Order
      // it belongs to exists (coupon_usages.orderId is NOT NULL + unique);
      // necessarily after validateAndClaim's usedCount CAS already
      // succeeded above, never before it.
      if (couponClaim) {
        await this.couponsService.recordUsage(tx, {
          couponId: couponClaim.couponId,
          userId,
          orderId: createdOrder.id,
          discountAppliedAmountPaise: discountPaise,
          tenantId: createdOrder.tenantId,
        });
      }

      for (const { item, pricing } of linePricing) {
        const orderItem = await tx.orderItem.create({
          data: {
            orderId: createdOrder.id,
            productId: item.productId,
            productNameSnapshot: item.product.name,
            variantLabelSnapshot: item.variant?.label ?? null,
            unitPriceSnapshot: paiseToDecimalString(pricing.unitPricePaise),
            quantity: item.quantity,
            lineTotal: paiseToDecimalString(pricing.lineTotalPaise),
            // Derived from the order this line belongs to — never a
            // client-supplied value (Phase 4 W7 / P4-D2).
            tenantId: createdOrder.tenantId,
          },
        });
        if (item.customizations.length > 0) {
          await tx.orderItemCustomization.createMany({
            data: item.customizations.map((c) => ({
              orderItemId: orderItem.id,
              fieldLabelSnapshot: c.customizationField.label,
              textValue: c.textValue,
              uploadedFileId: c.uploadedFileId,
              tenantId: orderItem.tenantId,
            })),
          });
        }
      }

      await tx.orderStatusHistory.create({
        data: {
          orderId: createdOrder.id,
          fromStatus: null,
          toStatus: OrderStatus.PENDING_PAYMENT,
          changedByUserId: userId,
          note: 'Order created from cart at checkout',
          // Derived from the order this history row belongs to — never a
          // client-supplied value (Phase 4 W7 / P4-D2).
          tenantId: createdOrder.tenantId,
        },
      });

      await this.idempotencyService.recordResult(tx, claim.id, createdOrder.id);

      return { orderId: createdOrder.id, created: true };
    }, { timeout: CHECKOUT_TRANSACTION_TIMEOUT_MS });

    return {
      view: await this.loadOrderView(result.orderId, userId),
      created: result.created,
    };
  }

  /**
   * POST /checkout/validate (§2.2) — read-only preview against the
   * caller's current cart, no transaction, no idempotency key, no coupon
   * usage claim. `getShippingFeePaise`/`priceItem` accept `this.prisma`
   * directly wherever they expect a `Prisma.TransactionClient` — the two
   * types are structurally compatible for the read-only calls those
   * methods make, so no second (transactional) code path is needed just
   * for this preview. Never authoritative: the real numbers are always
   * whatever POST /checkout/orders's own transaction computes, which may
   * differ if the cart, catalog, or coupon state changes in between
   * (Business Rule 1 — the backend, never a prior response, is the price
   * authority).
   */
  async previewCheckout(
    userId: string,
    couponCode: string | undefined,
  ): Promise<CheckoutPreviewView> {
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
      include: {
        items: {
          orderBy: { createdAt: 'asc' },
          include: CHECKOUT_CART_ITEM_INCLUDE,
        },
      },
    });
    if (!cart || cart.items.length === 0) {
      throw new BadRequestException('Your cart is empty');
    }

    // Phase 5 W4 — same rationale as createOrder above: a pricing preview
    // is still "normal storefront commerce data" for a suspended tenant.
    await assertTenantActive(
      this.prisma,
      cart.tenantId,
      'This store is currently unavailable',
    );

    const storeId = await resolvePrimaryStoreId(this.prisma, cart.tenantId);
    const shippingFeePaise = await this.getShippingFeePaise(
      this.prisma,
      storeId,
    );
    const linePricing = cart.items.map((item) => ({
      item,
      pricing: this.priceItem(item),
    }));
    const subtotalPaise = this.pricingService.sumLineTotals(
      linePricing.map((l) => l.pricing),
    );

    let discountPaise = 0n;
    let finalShippingFeePaise = shippingFeePaise;
    let normalizedCouponCode: string | null = null;
    if (couponCode) {
      const preview = await this.couponsService.previewDiscount({
        code: couponCode,
        userId,
        subtotalPaise,
        shippingFeePaise,
        lineItems: linePricing.map(({ item, pricing }) => ({
          categoryId: item.product.categoryId,
          lineTotalPaise: pricing.lineTotalPaise,
        })),
        // Derived from the cart being previewed — never a client-supplied
        // value (Phase 4 W7 / P4-D2; W10 hardening).
        tenantId: cart.tenantId,
      });
      discountPaise = preview.discountPaise;
      finalShippingFeePaise = preview.shippingFeePaise;
      normalizedCouponCode = preview.couponCode;
    }

    const taxConfig = await this.taxService.getConfig(cart.tenantId);
    const taxComputation = this.taxService.computeTax(
      subtotalPaise - discountPaise,
      taxConfig,
    );
    const { taxToAddPaise, orderTaxFields } = this.applyTax(taxComputation);

    const totalPaise = this.pricingService.computeOrderTotal({
      subtotalPaise,
      shippingFeePaise: finalShippingFeePaise,
      discountPaise,
      taxToAddPaise,
    });

    return {
      subtotal: paiseToDecimalString(subtotalPaise),
      shippingFee: paiseToDecimalString(finalShippingFeePaise),
      discountAmount: paiseToDecimalString(discountPaise),
      taxableAmount: orderTaxFields.taxableAmount,
      taxAmount: orderTaxFields.taxAmount,
      taxMode: orderTaxFields.taxMode,
      total: paiseToDecimalString(totalPaise),
      couponCode: normalizedCouponCode,
    };
  }

  /**
   * §11 "A product/variant deactivated between cart-view and checkout-
   * submit is caught inside the checkout transaction" — one of §27's
   * must-pass tests. Also re-checks quantity bounds and re-runs the same
   * (pure, Phase 3) shape/surcharge validation per customization, in case
   * an admin edited a field's constraints after the item was added.
   */
  private assertItemsCheckoutable(items: readonly CheckoutCartItem[]): void {
    for (const item of items) {
      if (!item.product.isActive) {
        throw new ConflictException(
          `"${item.product.name}" is no longer available — remove it from your cart before checking out`,
        );
      }
      if (item.variant && !item.variant.isAvailable) {
        throw new ConflictException(
          `The selected option for "${item.product.name}" is no longer available — remove it from your cart before checking out`,
        );
      }
      const max = item.product.maxQuantity ?? PLATFORM_DEFAULT_MAX_QUANTITY;
      if (item.quantity < item.product.minQuantity || item.quantity > max) {
        throw new BadRequestException(
          `Quantity for "${item.product.name}" is no longer valid (must be between ${item.product.minQuantity} and ${max})`,
        );
      }
      for (const c of item.customizations) {
        const result = validateCustomizationFieldShape(c.customizationField, {
          textValue: c.textValue ?? undefined,
          uploadedFileId: c.uploadedFileId ?? undefined,
        });
        if (!result.valid) {
          throw new BadRequestException(result.error);
        }
      }
    }
  }

  /** Phase 5 W9 (decision D11) — shippingFeeFlat is STORE-owned, read from
   * `StoreSetting`. `storeId` is always resolved server-side via
   * `resolvePrimaryStoreId` beforehand — never a client-supplied value. */
  private async getShippingFeePaise(
    client: Pick<PrismaService, 'storeSetting'>,
    storeId: string,
  ): Promise<bigint> {
    const setting = await client.storeSetting.findUnique({
      where: { storeId_key: { storeId, key: SHIPPING_FEE_SETTING_KEY } },
    });
    return setting ? decimalToPaise(new Prisma.Decimal(setting.value)) : 0n;
  }

  /** Same §11 canonical per-line formula as cart, computed via PricingService. */
  private priceItem(item: CheckoutCartItem): OrderLinePricing {
    const basePricePaise = decimalToPaise(item.product.basePrice);
    const variantDeltaPaise = item.variant
      ? decimalToPaise(item.variant.priceDelta)
      : 0n;
    let surchargePaise = 0n;
    for (const c of item.customizations) {
      const result = validateCustomizationFieldShape(c.customizationField, {
        textValue: c.textValue ?? undefined,
        uploadedFileId: c.uploadedFileId ?? undefined,
      });
      surchargePaise += result.surchargePaise;
    }
    return this.pricingService.computeLine({
      basePricePaise,
      variantDeltaPaise,
      surchargePaise,
      quantity: item.quantity,
    });
  }

  private async loadOrderView(
    orderId: string,
    userId: string,
  ): Promise<OrderView> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: ORDER_DETAIL_INCLUDE,
    });
    if (!order || order.userId !== userId) {
      // Unreachable via normal flow (the userId match on the idempotency
      // key already guards this) — defensive only, never leaks existence.
      throw new ConflictException('Order not found for this user');
    }
    return this.toOrderView(order);
  }

  private toOrderView(order: OrderWithItems): OrderView {
    const subtotalPaise = decimalToPaise(order.subtotal);
    const totalPaise = decimalToPaise(order.total);

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      subtotal: paiseToDecimalString(subtotalPaise),
      shippingFee: paiseToDecimalString(decimalToPaise(order.shippingFee)),
      total: paiseToDecimalString(totalPaise),
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
      shippingRecipientName: order.shippingRecipientName,
      shippingPhone: order.shippingPhone,
      shippingAddressLine1: order.shippingAddressLine1,
      shippingAddressLine2: order.shippingAddressLine2,
      shippingCity: order.shippingCity,
      shippingState: order.shippingState,
      shippingPostalCode: order.shippingPostalCode,
      shippingCountry: order.shippingCountry,
      items: order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.productNameSnapshot,
        variantLabel: item.variantLabelSnapshot,
        unitPrice: paiseToDecimalString(decimalToPaise(item.unitPriceSnapshot)),
        quantity: item.quantity,
        lineTotal: paiseToDecimalString(decimalToPaise(item.lineTotal)),
        customizations: item.customizations.map((c) => ({
          fieldLabel: c.fieldLabelSnapshot,
          textValue: c.textValue,
          uploadedFileId: c.uploadedFileId,
        })),
      })),
      createdAt: order.createdAt,
    };
  }
}
