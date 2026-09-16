import { randomUUID } from 'crypto';
import * as Sentry from '@sentry/node';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Order,
  OrderStatus,
  PaymentAttempt,
  PaymentAttemptStatus,
  PaymentProviderType,
  Prisma,
  RefundStatus,
} from '@prisma/client';
import { PrismaService } from '../common/database/prisma.service';
import { decimalToPaise } from '../cart/pricing/money.util';
import { isTransitionAllowed } from '../orders/state-machine/order-state-machine';
import { PaymentAccountResolutionError } from './payment-accounts/payment-account-resolution.errors';
import {
  PaymentAccountResolutionService,
  ResolvedPaymentAccount,
  ResolvedWebhookPaymentAccount,
} from './payment-accounts/payment-account-resolution.service';
import { PaymentAccountsService } from './payment-accounts/payment-accounts.service';
import {
  MerchantPaymentUnavailableError,
  PaymentProviderUnavailableError,
} from './merchant-commerce.errors';
import { PaymentProviderError } from './providers/payment-provider.errors';
import { RazorpayService } from './razorpay/razorpay.service';
import { PaymentMismatchError } from './payment-mismatch.error';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import {
  InitiatePaymentView,
  VerifyPaymentView,
} from './dto/payment-views.interface';

/** Minimal shape of the Razorpay payment entity fields this module reads. */
interface RazorpayPaymentEntity {
  id: string;
  order_id: string;
  amount: number | string;
  currency?: string;
  status: string;
  method?: string;
  error_code?: string;
  error_description?: string;
}

/** Minimal shape of the Razorpay refund entity fields this module reads
 * (P8-11) — mirrors `RazorpayPaymentEntity`'s own "only what we read"
 * discipline. */
interface RazorpayRefundEntity {
  id: string;
  payment_id: string;
  amount: number | string;
  status: string;
  /** Present on a `refund.failed` delivery; absent otherwise. */
  error_description?: string;
}

/**
 * P8-13 (P1 #2 remediation, docs/saas/PHASE-8-SECURITY-AUDIT.md §9/§18) —
 * thrown by `applyRefundWebhookEvent` when a `refund.processed`/
 * `refund.failed` delivery names a `razorpayRefundId` this database does
 * not yet have. This is deliberately a THROW, not a return of `'IGNORED'`:
 * `RefundsService.callProviderAndSettle` stamps `razorpayRefundId` onto
 * the local `Refund` row only after its own `createRefund` API call
 * returns, so a fast-arriving webhook for that exact refund can genuinely
 * win the race and find nothing yet. Throwing routes this event through
 * `WebhookProcessor.processOne`'s EXISTING bounded-backoff retry (30s,
 * 2m, 10m, 30m, 1h, 2h — unchanged, no new retry infrastructure) instead
 * of the payment-side "unknown razorpayOrderId" precedent's permanent
 * `'IGNORED'` — that precedent is correct for payments (`Order.
 * razorpayOrderId` is stamped synchronously, before a customer can even
 * pay, so no such race exists there) but was silently WRONG for refunds,
 * where the local stamp genuinely happens after an outbound provider
 * call. By the first retry (>=30s later), `callProviderAndSettle`'s own
 * write — a single `await` immediately after the provider call returns —
 * will already have completed in every realistic case, so the retry finds
 * the row and settles it correctly. A truly foreign/malformed
 * `razorpayRefundId` (not a race, genuinely unknown) simply exhausts the
 * same existing retry budget and dead-letters with a Sentry alert,
 * exactly like any other unresolvable webhook event — strictly better
 * observability than the previous silent, permanent `'IGNORED'`.
 */
export class UnresolvedRefundWebhookError extends Error {
  constructor(readonly razorpayRefundId: string) {
    super(
      `No local Refund found yet for razorpayRefundId=${razorpayRefundId} — retrying (may be a provider-call/webhook race)`,
    );
    this.name = 'UnresolvedRefundWebhookError';
  }
}

const DEFAULT_CURRENCY = 'INR';

/** Outcome of a reconciliation-driven capture attempt (Phase 13.3). */
export type ReconcileCaptureResult = 'PAID' | 'ALREADY_TERMINAL' | 'MISMATCH';

export interface RazorpayWebhookPayload {
  event: string;
  payload?: {
    payment?: { entity: RazorpayPaymentEntity };
    /** P8-11 — present only on `refund.processed`/`refund.failed`
     * deliveries. Purely additive: the pre-existing global `receiveWebhook`/
     * `applyWebhookEvent` pipeline never reads this field, so this
     * addition changes nothing about that pipeline's behavior. */
    refund?: { entity: RazorpayRefundEntity };
  };
  created_at?: number;
}

const CAPTURED_EVENT = 'payment.captured';
const FAILED_EVENT = 'payment.failed';
/** P8-11 — the two refund-completion events the merchant commerce webhook
 * pipeline now recognizes (task item 8: "add only the minimal event
 * handling required"). Never wired into the pre-existing global
 * `applyWebhookEvent` path — only `applyMerchantWebhookEvent`. */
const REFUND_PROCESSED_EVENT = 'refund.processed';
const REFUND_FAILED_EVENT = 'refund.failed';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly razorpayService: RazorpayService,
    private readonly paymentAccountResolutionService: PaymentAccountResolutionService,
    private readonly paymentAccountsService: PaymentAccountsService,
  ) {}

  // ─── POST /checkout/orders/:id/retry-payment ──────────────────────────
  //
  // Same flow for the very first payment attempt on a fresh PENDING_PAYMENT
  // order and for a genuine retry after PAYMENT_FAILED (§12.4's diagram has
  // no separate "first initiation" endpoint — "reuses razorpayOrderId if
  // set" naturally covers both: nothing to reuse on the first call, an
  // existing id to reuse on a retry).

  async initiatePayment(
    userId: string,
    orderId: string,
  ): Promise<InitiatePaymentView> {
    let order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.userId !== userId) {
      // Ownership: never confirm/deny another user's order exists.
      throw new NotFoundException('Order not found');
    }

    if (order.status === OrderStatus.PAYMENT_FAILED) {
      const transitioned = await this.transitionOrder(
        this.prisma,
        order,
        OrderStatus.PENDING_PAYMENT,
        userId,
        'Customer retrying payment',
      );
      order =
        transitioned ??
        (await this.prisma.order.findUniqueOrThrow({
          where: { id: order.id },
        }));
    }

    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      throw new ConflictException(
        `Order is not payable in its current status (${order.status})`,
      );
    }

    // Phase 8 (P8-7 bound the FK; P8-9 makes it authoritative) — bind the
    // merchant PaymentAccount this order's payment routes through, exactly
    // once, at THIS boundary (the moment payment is actually initiated —
    // checkout itself creates the Order without any payment-provider
    // routing, unchanged, P8-6/P8-7 reports).
    //
    // Only attempted while `paymentAccountId` is still null — once bound,
    // never re-resolved (P8-3 §6: "resolve once... persist the FK; never
    // re-resolve"), and the CAS update below (`WHERE paymentAccountId IS
    // NULL`) is what makes two concurrent initiatePayment calls unable to
    // bind the same order to two different accounts (task item 7).
    //
    // P8-9 (deliberate, explicitly-authorized behavior change from P8-7):
    // an unresolvable/inactive PaymentAccount is no longer a silent
    // no-op — merchant commerce payment creation has no global/platform
    // fallback credential to fall back to (strict rule), so a missing
    // active account now fails this call outright with a stable,
    // merchant-onboarding-shaped error (P8-3 §6 point 4, deferred by P8-7,
    // implemented here — the stage that actually wires a PaymentAccount's
    // credentials into real payment creation).
    let resolvedAccount: ResolvedPaymentAccount;
    if (order.paymentAccountId) {
      resolvedAccount = await this.resolveBoundAccountOrFail(
        order.tenantId,
        order.paymentAccountId,
      );
    } else if (!order.storeId) {
      // No storeId at all ⇒ structurally no way to resolve a
      // PaymentAccount — same customer-facing outcome as any other
      // resolution failure, never a generic 500.
      throw new MerchantPaymentUnavailableError();
    } else {
      try {
        const resolved = await this.paymentAccountResolutionService.resolveForStore(
          order.tenantId,
          order.storeId,
          PaymentProviderType.RAZORPAY,
        );
        const bind = await this.prisma.order.updateMany({
          where: { id: order.id, paymentAccountId: null },
          data: { paymentAccountId: resolved.paymentAccountId },
        });
        if (bind.count === 1) {
          order = { ...order, paymentAccountId: resolved.paymentAccountId };
          resolvedAccount = resolved;
        } else {
          // Lost a concurrent double-bind race — the other caller's
          // resolution already won; re-read and resolve THAT id so the
          // PaymentAttempt created below carries the WINNING account,
          // never ours (same §13.H shape as the razorpayOrderId race
          // just below).
          const fresh = await this.prisma.order.findUniqueOrThrow({
            where: { id: order.id },
          });
          order = { ...order, paymentAccountId: fresh.paymentAccountId };
          resolvedAccount = await this.resolveBoundAccountOrFail(
            order.tenantId,
            fresh.paymentAccountId!,
          );
        }
      } catch (err) {
        if (err instanceof PaymentAccountResolutionError) {
          // No ACTIVE PaymentAccount configured for this store (or the
          // store itself couldn't be confirmed) — fail cleanly, never
          // fall back to any global/platform credential.
          throw new MerchantPaymentUnavailableError();
        }
        throw err;
      }
    }

    // Merchant credentials are fetched ONCE per call — needed for every
    // response (the frontend's Checkout.js widget needs the bound
    // account's own public key id every time it opens, retries included,
    // not only on first creation) and, when a fresh provider order is
    // needed below, for that call too. Never logged, never returned.
    const encryptedCredentials = await this.paymentAccountsService.getEncryptedCredentials(
      order.tenantId,
      resolvedAccount.paymentAccountId,
    );
    if (!encryptedCredentials) {
      throw new MerchantPaymentUnavailableError();
    }

    // Every external call sits outside any Postgres transaction (§13
    // preamble) — the Razorpay order create below, then a single-row CAS
    // update, mirrors §12.4's TXN2/D split exactly. Reuses
    // `Order.razorpayOrderId`'s existing CAS/uniqueness mechanism
    // unchanged (task item 3/8) — no new idempotency infrastructure.
    let razorpayOrderId = order.razorpayOrderId;
    if (!razorpayOrderId) {
      const amountPaise = decimalToPaise(order.total);
      let rpOrder;
      try {
        rpOrder = await resolvedAccount.adapter.createOrder(encryptedCredentials, {
          amountPaise,
          currency: order.currency,
          receipt: order.orderNumber,
        });
      } catch (err) {
        // Provider/credential failure — never create a PaymentAttempt,
        // never touch Order.razorpayOrderId, leave both exactly as they
        // were (task item 7: consistent state on failure).
        throw this.translateProviderError(err);
      }
      const assoc = await this.prisma.order.updateMany({
        where: { id: order.id, razorpayOrderId: null },
        data: { razorpayOrderId: rpOrder.providerOrderId },
      });
      if (assoc.count === 1) {
        razorpayOrderId = rpOrder.providerOrderId;
      } else {
        // Lost a concurrent double-association race (§13.H) — the other
        // caller's Razorpay order won; ours is a harmless orphan.
        const fresh = await this.prisma.order.findUniqueOrThrow({
          where: { id: order.id },
        });
        razorpayOrderId = fresh.razorpayOrderId!;
      }
    }

    const amountPaise = decimalToPaise(order.total);
    const attempt = await this.prisma.paymentAttempt.create({
      data: {
        orderId: order.id,
        razorpayOrderId,
        amountPaise,
        currency: order.currency,
        status: PaymentAttemptStatus.INITIATED,
        // Derived from the order this attempt belongs to — never a
        // client-supplied value (Phase 4 W7 / P4-D2).
        tenantId: order.tenantId,
        // Phase 8/9 — the SAME bound account resolved above; never
        // independently re-resolved here (task item 4 — no race between
        // "which account this attempt records" and "which account
        // actually created the provider order").
        paymentAccountId: resolvedAccount.paymentAccountId,
      },
    });

    return {
      paymentAttemptId: attempt.id,
      razorpayOrderId,
      // The bound merchant account's OWN public key id — never the
      // Phase 7 global/SaaS key (task strict rule / item 9).
      razorpayKeyId: resolvedAccount.adapter.getPublicKeyId(encryptedCredentials),
      amountPaise: amountPaise.toString(),
      currency: order.currency,
    };
  }

  /** `resolveForBoundAccount` throws plain `PaymentAccountResolutionError`
   * subclasses (never an HTTP shape — see that file's own doc comment);
   * this is `PaymentsService`'s one translation point to the stable,
   * customer-facing 422 (task item 2/7 — no distinction surfaced between
   * "tenant mismatch" / "unsupported provider" / anything else, same
   * existence-leak-avoidance discipline `PaymentAccountTenantMismatchError`
   * itself already establishes). A non-resolution error (e.g. the
   * database itself being down) is never swallowed here. */
  private async resolveBoundAccountOrFail(
    tenantId: string,
    paymentAccountId: string,
  ): Promise<ResolvedPaymentAccount> {
    try {
      return await this.paymentAccountResolutionService.resolveForBoundAccount(
        tenantId,
        paymentAccountId,
      );
    } catch (err) {
      if (err instanceof PaymentAccountResolutionError) {
        throw new MerchantPaymentUnavailableError();
      }
      throw err;
    }
  }

  /** Translates a `PaymentProviderError` (Razorpay API/transport failure,
   * or a credential-decryption failure — both already credential-free per
   * `RazorpayProviderAdapter`'s own boundary) into the one stable 502 a
   * customer response ever carries. Never re-surfaces the provider
   * error's own message, status, or code — those stay server-side-only
   * (task item 7: "not expose raw SDK internals"). A non-provider error
   * is never swallowed here either. */
  private translateProviderError(err: unknown): Error {
    if (err instanceof PaymentProviderError) {
      return new PaymentProviderUnavailableError();
    }
    return err instanceof Error ? err : new Error(String(err));
  }

  // ─── POST /payments/verify ─────────────────────────────────────────────
  //
  // Synchronous, single transaction (§13.I) — unlike the webhook, this is a
  // foreground call the frontend awaits a definitive answer from.

  async verifyPayment(
    userId: string,
    dto: VerifyPaymentDto,
  ): Promise<VerifyPaymentView> {
    // Order lookup now has to happen BEFORE signature verification (a
    // reversal of the pre-P8-9 order): each merchant account has its OWN
    // key secret, so which secret to verify against can only be known
    // once we know which Order (and therefore which bound PaymentAccount)
    // this `razorpay_order_id` belongs to. `razorpay_order_id` is an
    // opaque, Razorpay-assigned unguessable token, so this reordering
    // does not create a practical enumeration path.
    const order = await this.prisma.order.findUnique({
      where: { razorpayOrderId: dto.razorpay_order_id },
    });
    if (!order || order.userId !== userId) {
      throw new NotFoundException('Order not found for this payment');
    }

    // Phase 8 (P8-9) — verify against the SAME bound PaymentAccount this
    // order's PaymentAttempt(s) were created under (task item 5): read
    // ONLY the already-persisted `Order.paymentAccountId` FK via
    // `resolveForBoundAccount` — never re-resolved from `Store`, and the
    // client-supplied `VerifyPaymentDto` has no account-selecting field
    // at all, so there is nothing for a client to override even in
    // principle. A `null` `paymentAccountId` here means this order predates
    // P8-9's now-mandatory binding at initiation — fails the same clean,
    // stable way as any other unresolvable-account case, never a global/
    // platform credential fallback.
    if (!order.paymentAccountId) {
      throw new MerchantPaymentUnavailableError();
    }
    const resolvedAccount = await this.resolveBoundAccountOrFail(
      order.tenantId,
      order.paymentAccountId,
    );
    const encryptedCredentials = await this.paymentAccountsService.getEncryptedCredentials(
      order.tenantId,
      resolvedAccount.paymentAccountId,
    );
    if (!encryptedCredentials) {
      throw new MerchantPaymentUnavailableError();
    }

    const signatureValid = resolvedAccount.adapter.verifyPaymentSignature(
      encryptedCredentials,
      {
        providerOrderId: dto.razorpay_order_id,
        providerPaymentId: dto.razorpay_payment_id,
        providerSignature: dto.razorpay_signature,
      },
    );
    if (!signatureValid) {
      throw new BadRequestException('Invalid payment signature');
    }

    // Fast path, no transaction: this exact payment was already captured
    // by an earlier call (this endpoint replayed, or a webhook that won
    // the race) — same success shape (§20), and critically avoids ever
    // picking a *different*, unrelated INITIATED attempt on this order
    // (there can legitimately be several — one per opened checkout
    // widget) the way a plain "most recent INITIATED" lookup would on
    // replay, which is what caused this to 500 before the fix: attempting
    // to stamp an already-used razorpayPaymentId onto a different row hit
    // that column's own unique constraint mid-transaction, and Postgres
    // aborts the whole transaction on any query error — a caught
    // exception doesn't let you keep issuing queries against it.
    const existingByPaymentId = await this.prisma.paymentAttempt.findUnique({
      where: { razorpayPaymentId: dto.razorpay_payment_id },
    });
    if (existingByPaymentId?.status === PaymentAttemptStatus.CAPTURED) {
      const current = await this.prisma.order.findUniqueOrThrow({
        where: { id: order.id },
      });
      return { orderId: current.id, status: current.status };
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const attempt =
          existingByPaymentId ??
          (await tx.paymentAttempt.findFirst({
            where: {
              orderId: order.id,
              razorpayOrderId: dto.razorpay_order_id,
              status: PaymentAttemptStatus.INITIATED,
            },
            orderBy: { createdAt: 'desc' },
          }));
        if (!attempt) {
          throw new ConflictException(
            'No pending payment attempt found for this order',
          );
        }

        const result = await tx.paymentAttempt.updateMany({
          where: {
            id: attempt.id,
            status: { not: PaymentAttemptStatus.CAPTURED },
          },
          data: {
            status: PaymentAttemptStatus.CAPTURED,
            razorpayPaymentId: dto.razorpay_payment_id,
            capturedAt: new Date(),
          },
        });

        if (result.count === 1) {
          await this.transitionOrder(
            tx,
            order,
            OrderStatus.PAID,
            userId,
            'Payment verified (client callback)',
          );
          await this.insertOutboxEvent(tx, 'ORDER_PAID', order);
        }

        const finalOrder = await tx.order.findUniqueOrThrow({
          where: { id: order.id },
        });
        return { orderId: finalOrder.id, status: finalOrder.status };
      });
    } catch (err) {
      if (!this.isUniqueConstraintViolation(err)) {
        throw err;
      }
      // Partial unique index (orderId) WHERE status='CAPTURED' — a
      // concurrent webhook (or another verify call) won for this order.
      // The transaction above rolled back cleanly on this error (Prisma's
      // guarantee), so it's safe to re-query fresh here — same success
      // shape, not our error to surface.
      this.logger.log(
        `verifyPayment: order ${order.id} already has a captured attempt (race) — no-op`,
      );
      const current = await this.prisma.order.findUniqueOrThrow({
        where: { id: order.id },
      });
      return { orderId: current.id, status: current.status };
    }
  }

  // ─── POST /payments/webhook — Phase 1 (controller calls this) ─────────
  //
  // §12.3: verify signature, INSERT webhook_events ON CONFLICT DO NOTHING,
  // done. Actual processing is Phase 2, run only by WebhookProcessor's
  // poller — never inline here, regardless of outcome.

  async receiveWebhook(
    rawBody: string,
    signature: string,
    headerEventId: string | undefined,
  ): Promise<void> {
    if (!this.razorpayService.verifyWebhookSignature(rawBody, signature)) {
      // §12.3: invalid signature → no DB write at all.
      throw new BadRequestException('Invalid webhook signature');
    }

    let payload: RazorpayWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as RazorpayWebhookPayload;
    } catch {
      throw new BadRequestException('Malformed webhook payload');
    }

    const razorpayEventId = this.extractWebhookEventId(headerEventId, payload);
    // Timestamps use `now() AT TIME ZONE 'UTC'` — the bare `timestamp`
    // columns store a UTC wall clock exactly as every Prisma
    // `@default(now())` write does, so the retry poller's
    // `availableAt <= new Date()` comparison lines up regardless of the DB
    // session timezone. (A plain SQL `now()` here would store local wall
    // clock and skew that comparison.)
    await this.prisma.$queryRaw`
      INSERT INTO webhook_events (id, "razorpayEventId", payload, status, attempts, "availableAt", "createdAt", "updatedAt")
      VALUES (
        ${randomUUID()},
        ${razorpayEventId},
        ${JSON.stringify(payload)}::jsonb,
        'RECEIVED',
        0,
        (now() AT TIME ZONE 'UTC'),
        (now() AT TIME ZONE 'UTC'),
        (now() AT TIME ZONE 'UTC')
      )
      ON CONFLICT ("razorpayEventId") DO NOTHING
    `;
  }

  // ─── POST /payments/webhook/:accountId — merchant commerce (P8-10) ────
  //
  // P8-3 §9's finalized routing model: the account is resolved from the
  // PATH PARAMETER, server-side, BEFORE any signature-verification
  // attempt — never by trying every active account's secret in sequence,
  // never by trusting an account hint inside the (unauthenticated,
  // pre-verification) payload body. Only after the correct account's
  // decrypted webhook secret is loaded does HMAC verification proceed.
  // Deliberately a SEPARATE method from `receiveWebhook` above (never
  // modified — task strict rule): that method stays exactly what it was,
  // still reachable at `POST /payments/webhook` for any order that
  // predates per-account routing (`paymentAccountId` stays `null` on
  // those `WebhookEvent` rows, exactly as before).

  async receiveMerchantWebhook(
    paymentAccountId: string,
    rawBody: string,
    signature: string,
    headerEventId: string | undefined,
  ): Promise<void> {
    let resolved: ResolvedWebhookPaymentAccount;
    try {
      resolved = await this.paymentAccountResolutionService.resolveForWebhook(
        paymentAccountId,
      );
    } catch (err) {
      if (err instanceof PaymentAccountResolutionError) {
        // Unknown account id in the path — same generic rejection as a
        // bad signature (never a distinguishable response; no account-
        // existence oracle on this unauthenticated endpoint).
        throw new BadRequestException('Invalid webhook signature');
      }
      throw err;
    }

    const encryptedCredentials = await this.paymentAccountsService.getEncryptedCredentials(
      resolved.tenantId,
      resolved.paymentAccountId,
    );

    let signatureValid = false;
    if (encryptedCredentials) {
      try {
        signatureValid = resolved.adapter.verifyWebhookSignature(
          encryptedCredentials,
          rawBody,
          signature,
        );
      } catch {
        // A credential-decrypt failure here is functionally "cannot
        // verify" — fail closed, never let it look like acceptance and
        // never let it surface as a 500.
        signatureValid = false;
      }
    }
    if (!signatureValid) {
      // §12.3 (unchanged discipline): invalid signature → no DB write at all.
      throw new BadRequestException('Invalid webhook signature');
    }

    let payload: RazorpayWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as RazorpayWebhookPayload;
    } catch {
      throw new BadRequestException('Malformed webhook payload');
    }

    const razorpayEventId = this.extractWebhookEventId(
      headerEventId,
      payload,
      resolved.paymentAccountId,
    );
    // Same INSERT ... ON CONFLICT DO NOTHING idempotency mechanism as
    // `receiveWebhook` (task item 4 — no new dedup infrastructure), with
    // `paymentAccountId` additionally stamped — this is what lets
    // `WebhookProcessor` route this row to the merchant-commerce
    // processing path in Phase 2, and what "identify PaymentAccount"
    // ultimately persists (never re-derived from the payload later).
    await this.prisma.$queryRaw`
      INSERT INTO webhook_events (id, "razorpayEventId", "paymentAccountId", payload, status, attempts, "availableAt", "createdAt", "updatedAt")
      VALUES (
        ${randomUUID()},
        ${razorpayEventId},
        ${resolved.paymentAccountId},
        ${JSON.stringify(payload)}::jsonb,
        'RECEIVED',
        0,
        (now() AT TIME ZONE 'UTC'),
        (now() AT TIME ZONE 'UTC'),
        (now() AT TIME ZONE 'UTC')
      )
      ON CONFLICT ("razorpayEventId") DO NOTHING
    `;
  }

  /**
   * The event-id field/header Razorpay uses for webhook dedup isn't
   * pinned down by anything in this repo (blueprint or SDK types) — I went
   * with the `X-Razorpay-Event-Id` header per Razorpay's own webhook docs
   * as the primary source, with a deterministic fallback derived from
   * stable payload fields so a retry of the same event still dedupes
   * correctly even if that header assumption is off. Flagged in the
   * completion report — worth confirming against a real delivery's headers
   * once the webhook is live.
   *
   * `fallbackScope` (P8-10) is folded into the synthetic fallback id only
   * — never the real header-derived id, which is untouched for
   * `receiveWebhook`'s existing call (omits the argument entirely). Razorpay
   * payment ids are themselves Razorpay-global unique tokens (not
   * merchant-sequential), so a cross-merchant collision in the fallback
   * path was already very unlikely; scoping it by `paymentAccountId`
   * removes even that residual doubt for the ONE case P8-3's own §8 table
   * flagged as "should be verified, not assumed" — closed here for the
   * per-account route specifically, without touching the shared global
   * `@unique` column itself (no schema change, no new infrastructure).
   */
  private extractWebhookEventId(
    headerId: string | undefined,
    payload: RazorpayWebhookPayload,
    fallbackScope?: string,
  ): string {
    if (headerId && headerId.trim().length > 0) {
      return headerId.trim();
    }
    const paymentId = payload.payload?.payment?.entity?.id ?? 'unknown';
    const scoped = fallbackScope ? `${fallbackScope}:` : '';
    return `${scoped}${payload.event}:${paymentId}:${payload.created_at ?? ''}`;
  }

  // ─── Webhook Phase 2 — called by WebhookProcessor's poller ─────────────

  /** Returns whether this event was acted on or ignored (WebhookEventStatus). */
  async applyWebhookEvent(
    tx: Prisma.TransactionClient,
    payload: RazorpayWebhookPayload,
  ): Promise<'PROCESSED' | 'IGNORED'> {
    const paymentEntity = payload.payload?.payment?.entity;
    if (
      !paymentEntity ||
      (payload.event !== CAPTURED_EVENT && payload.event !== FAILED_EVENT)
    ) {
      return 'IGNORED';
    }

    const order = await tx.order.findUnique({
      where: { razorpayOrderId: paymentEntity.order_id },
    });
    if (!order) {
      this.logger.warn(
        `Webhook ${payload.event} for unknown razorpayOrderId=${paymentEntity.order_id}`,
      );
      return 'IGNORED';
    }

    const attempt = await this.findOrCreateAttempt(tx, order, paymentEntity);

    if (payload.event === CAPTURED_EVENT) {
      await this.applyCaptured(tx, order, attempt, paymentEntity);
    } else {
      await this.applyFailed(tx, order, attempt, paymentEntity);
    }
    return 'PROCESSED';
  }

  /** §12.1: "upserting the row first if the webhook arrived before any local row existed — handled, not assumed away." */
  private async findOrCreateAttempt(
    tx: Prisma.TransactionClient,
    order: Order,
    paymentEntity: RazorpayPaymentEntity,
  ): Promise<PaymentAttempt> {
    const byPaymentId = await tx.paymentAttempt.findUnique({
      where: { razorpayPaymentId: paymentEntity.id },
    });
    if (byPaymentId) {
      return byPaymentId;
    }

    const byOrder = await tx.paymentAttempt.findFirst({
      where: {
        orderId: order.id,
        razorpayOrderId: paymentEntity.order_id,
        status: PaymentAttemptStatus.INITIATED,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (byOrder) {
      return tx.paymentAttempt.update({
        where: { id: byOrder.id },
        data: { razorpayPaymentId: paymentEntity.id },
      });
    }

    return tx.paymentAttempt.create({
      data: {
        orderId: order.id,
        razorpayOrderId: paymentEntity.order_id,
        razorpayPaymentId: paymentEntity.id,
        amountPaise: BigInt(paymentEntity.amount),
        status: PaymentAttemptStatus.INITIATED,
        // Derived from the order this attempt belongs to — never a
        // client-supplied value (Phase 4 W7 / P4-D2).
        tenantId: order.tenantId,
      },
    });
  }

  // ─── Merchant commerce webhook Phase 2 (P8-10) ─────────────────────────
  //
  // Called by WebhookProcessor for any `WebhookEvent` row whose
  // `paymentAccountId` is set (i.e. one persisted by `receiveMerchantWebhook`
  // above) — `applyWebhookEvent`/`findOrCreateAttempt`/`applyCaptured`/
  // `applyFailed` above are UNTOUCHED and keep handling every
  // `paymentAccountId IS NULL` row exactly as before (task strict rule).

  /** Returns whether this event was acted on or ignored (WebhookEventStatus). */
  async applyMerchantWebhookEvent(
    tx: Prisma.TransactionClient,
    paymentAccountId: string,
    payload: RazorpayWebhookPayload,
  ): Promise<'PROCESSED' | 'IGNORED'> {
    // P8-11 — refund-completion events are handled by their own method;
    // never mixed into the payment-capture/-failure branch below.
    if (
      payload.event === REFUND_PROCESSED_EVENT ||
      payload.event === REFUND_FAILED_EVENT
    ) {
      return this.applyRefundWebhookEvent(tx, paymentAccountId, payload);
    }

    const paymentEntity = payload.payload?.payment?.entity;
    if (
      !paymentEntity ||
      (payload.event !== CAPTURED_EVENT && payload.event !== FAILED_EVENT)
    ) {
      return 'IGNORED';
    }

    const order = await tx.order.findUnique({
      where: { razorpayOrderId: paymentEntity.order_id },
    });
    if (!order) {
      this.logger.warn(
        `Merchant webhook ${payload.event} for unknown razorpayOrderId=${paymentEntity.order_id} (account ${paymentAccountId})`,
      );
      return 'IGNORED';
    }

    // Account/tenant isolation (task item 6/8/11 — the core security
    // boundary this stage adds): this webhook was cryptographically
    // verified against `paymentAccountId`'s OWN secret, but that alone
    // does not license it to modify ANY order — only orders actually
    // BOUND to that same account. An order bound to a DIFFERENT account
    // (or never bound at all) is left completely untouched: never
    // silently re-resolved/re-bound to this webhook's account, matching
    // P8-3 §6's "resolve once, persist the FK, never re-resolve" exactly.
    if (order.paymentAccountId !== paymentAccountId) {
      this.logger.warn(
        `Merchant webhook ${payload.event} for order ${order.id} rejected — bound to a different PaymentAccount (expected ${order.paymentAccountId ?? 'none'}, got ${paymentAccountId})`,
      );
      return 'IGNORED';
    }

    // Re-confirms the account still resolves (task item 6: "use
    // resolveForBoundAccount()") — defense-in-depth; the adapter it
    // returns is not otherwise needed for capture/fail application below
    // (which trusts the already-verified webhook payload's own fields,
    // exactly like the pre-P8-10 global path — task item 3: "preserve
    // existing... semantics unless there is a specific reason to change
    // them"). A resolution failure here (structurally shouldn't happen —
    // the row was just read above) is treated as IGNORED, not a crash.
    try {
      await this.paymentAccountResolutionService.resolveForBoundAccount(
        order.tenantId,
        paymentAccountId,
      );
    } catch (err) {
      if (err instanceof PaymentAccountResolutionError) {
        this.logger.warn(
          `Merchant webhook ${payload.event} for order ${order.id}: bound PaymentAccount ${paymentAccountId} no longer resolves (${err.name}) — ignoring`,
        );
        return 'IGNORED';
      }
      throw err;
    }

    const attempt = await this.findOrCreateMerchantAttempt(
      tx,
      order,
      paymentEntity,
      paymentAccountId,
    );

    if (payload.event === CAPTURED_EVENT) {
      await this.applyCaptured(tx, order, attempt, paymentEntity);
    } else {
      await this.applyFailed(tx, order, attempt, paymentEntity);
    }
    return 'PROCESSED';
  }

  /**
   * P8-11 — the "webhook/reconciliation completion where applicable" leg
   * of the refund lifecycle: `RefundsService.createRefund` already
   * settles a refund immediately when Razorpay's `createRefund` response
   * itself reports `status: 'processed'`; this method exists for the
   * `status: 'pending'` case (typical for card refunds — Razorpay
   * confirms completion asynchronously), CAS-transitioning that same
   * still-`PENDING` `Refund` row onward once Razorpay's own webhook
   * confirms the outcome. Never wired into the pre-existing global
   * `applyWebhookEvent`/`receiveWebhook` pipeline (untouched).
   *
   * Same account-isolation discipline as `applyMerchantWebhookEvent`'s
   * own payment-event branch: a webhook verified for `paymentAccountId`
   * may only touch a `Refund` row bound to that SAME account — a
   * mismatch (or an unknown `razorpayRefundId`) is `IGNORED`, never
   * processed.
   */
  private async applyRefundWebhookEvent(
    tx: Prisma.TransactionClient,
    paymentAccountId: string,
    payload: RazorpayWebhookPayload,
  ): Promise<'PROCESSED' | 'IGNORED'> {
    const refundEntity = payload.payload?.refund?.entity;
    if (!refundEntity) {
      return 'IGNORED';
    }

    // `Refund.razorpayRefundId` is `@unique` (schema.prisma) — this lookup
    // can never return more than one candidate row; "found" is
    // unambiguous by DB-level construction, not by convention (P8-13
    // explicit verification of the uniqueness assumption).
    const refund = await tx.refund.findUnique({
      where: { razorpayRefundId: refundEntity.id },
    });
    if (!refund) {
      // P8-13 (P1 #2 fix): THROW, never return 'IGNORED' — see
      // `UnresolvedRefundWebhookError`'s own doc comment for why this one
      // branch (and only this one) must be retryable. `WebhookProcessor`
      // needs no change: any thrown, non-`PaymentMismatchError`,
      // non-P2002 error already gets its existing bounded-backoff retry.
      this.logger.warn(
        `Merchant refund webhook ${payload.event} for razorpayRefundId=${refundEntity.id} (account ${paymentAccountId}) found no local Refund yet — will retry`,
      );
      throw new UnresolvedRefundWebhookError(refundEntity.id);
    }

    // Same isolation discipline as the payment-event branch above — a
    // webhook cryptographically verified for one account may only ever
    // touch a Refund row bound to that SAME account (task item 8/11:
    // never silently re-attributed to a different account).
    if (refund.paymentAccountId !== paymentAccountId) {
      this.logger.warn(
        `Merchant refund webhook ${payload.event} for refund ${refund.id} rejected — bound to a different PaymentAccount (expected ${refund.paymentAccountId ?? 'none'}, got ${paymentAccountId})`,
      );
      return 'IGNORED';
    }

    if (payload.event === REFUND_FAILED_EVENT) {
      await tx.refund.updateMany({
        where: { id: refund.id, status: RefundStatus.PENDING },
        data: {
          status: RefundStatus.FAILED,
          failureReason: refundEntity.error_description ?? 'Refund failed',
        },
      });
      return 'PROCESSED';
    }

    // REFUND_PROCESSED_EVENT — never blindly trust the reported amount;
    // a mismatch is exactly `PaymentMismatchError`'s existing "reason"
    // shape (reused, not a new error type), giving this the SAME
    // non-retryable dead-letter + Sentry treatment
    // `WebhookProcessor.processOne` already applies to a payment-amount
    // mismatch.
    const reportedAmount = BigInt(refundEntity.amount);
    if (reportedAmount !== refund.amountPaise) {
      throw new PaymentMismatchError(
        'AMOUNT_MISMATCH',
        `refund ${refund.id}: expected ${refund.amountPaise.toString()} paise, got ${reportedAmount.toString()} paise`,
      );
    }

    await tx.refund.updateMany({
      where: { id: refund.id, status: RefundStatus.PENDING },
      data: { status: RefundStatus.PROCESSED },
    });
    return 'PROCESSED';
  }

  /** Same shape as `findOrCreateAttempt`, with `paymentAccountId` stamped
   * on the create branch (task item 6: "preserve provider IDs" / stamp
   * the bound account) — kept as its own method rather than adding an
   * optional parameter to the existing one, so `findOrCreateAttempt`
   * itself stays byte-for-byte unchanged. */
  private async findOrCreateMerchantAttempt(
    tx: Prisma.TransactionClient,
    order: Order,
    paymentEntity: RazorpayPaymentEntity,
    paymentAccountId: string,
  ): Promise<PaymentAttempt> {
    const byPaymentId = await tx.paymentAttempt.findUnique({
      where: { razorpayPaymentId: paymentEntity.id },
    });
    if (byPaymentId) {
      return byPaymentId;
    }

    const byOrder = await tx.paymentAttempt.findFirst({
      where: {
        orderId: order.id,
        razorpayOrderId: paymentEntity.order_id,
        status: PaymentAttemptStatus.INITIATED,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (byOrder) {
      return tx.paymentAttempt.update({
        where: { id: byOrder.id },
        data: { razorpayPaymentId: paymentEntity.id },
      });
    }

    return tx.paymentAttempt.create({
      data: {
        orderId: order.id,
        razorpayOrderId: paymentEntity.order_id,
        razorpayPaymentId: paymentEntity.id,
        amountPaise: BigInt(paymentEntity.amount),
        status: PaymentAttemptStatus.INITIATED,
        // Derived from the order this attempt belongs to — never a
        // client-supplied value (Phase 4 W7 / P4-D2).
        tenantId: order.tenantId,
        paymentAccountId,
      },
    });
  }

  private async applyCaptured(
    tx: Prisma.TransactionClient,
    order: Order,
    attempt: PaymentAttempt,
    paymentEntity: RazorpayPaymentEntity,
  ): Promise<void> {
    // §12.1 / Phase 13.3 §4 — a captured payment whose amount, currency,
    // or Razorpay order id does not EXACTLY match this order is never
    // accepted: this throws PaymentMismatchError, which rolls back the
    // whole transaction (nothing partial) and is dead-lettered +
    // Sentry-reported by WebhookProcessor.processOne. The order stays
    // PENDING_PAYMENT for investigation.
    this.assertCapturedPaymentMatchesOrder(order, {
      razorpayOrderId: paymentEntity.order_id,
      amountPaise: BigInt(paymentEntity.amount),
      currency: paymentEntity.currency ?? DEFAULT_CURRENCY,
    });

    // Deliberately no try/catch here: a P2002 on the partial unique index
    // (a concurrent verify/webhook already captured a different attempt
    // for this order) must abort this whole transaction, not be caught
    // and continued past — Postgres keeps a transaction aborted after any
    // failed statement within it, so any further query on this same `tx`
    // would itself fail with "current transaction is aborted" regardless
    // of the JS-level catch. WebhookProcessor.processOne catches this
    // specific error *outside* the transaction and treats it as the
    // no-op it is (see isUniqueConstraintViolation, made public for it).
    const result = await tx.paymentAttempt.updateMany({
      where: {
        id: attempt.id,
        status: { not: PaymentAttemptStatus.CAPTURED },
      },
      data: {
        status: PaymentAttemptStatus.CAPTURED,
        razorpayPaymentId: paymentEntity.id,
        method: paymentEntity.method,
        capturedAt: new Date(),
      },
    });

    if (result.count !== 1) {
      return; // duplicate delivery of an event we already applied — no-op
    }

    if (!isTransitionAllowed(order.status, OrderStatus.PAID)) {
      // The attempt is now correctly recorded CAPTURED (money WAS taken),
      // but the order is no longer PENDING_PAYMENT — e.g. reconciliation
      // already gave up on it as stale. Do NOT force an illegal
      // transition; surface it loudly for a human instead.
      this.logger.error(
        `Captured payment for order ${order.id} which is in ${order.status}, not PENDING_PAYMENT — attempt recorded CAPTURED, order left as-is`,
      );
      Sentry.captureMessage('Captured payment on a non-pending order', {
        level: 'error',
        tags: { area: 'payments_capture_state' },
        extra: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          orderStatus: order.status,
          razorpayOrderId: order.razorpayOrderId ?? '',
          razorpayPaymentId: paymentEntity.id,
        },
      });
      return;
    }

    const transitioned = await this.transitionOrder(
      tx,
      order,
      OrderStatus.PAID,
      null,
      'Payment captured (webhook)',
    );
    if (transitioned) {
      await this.insertOutboxEvent(tx, 'ORDER_PAID', order);
    }
  }

  /**
   * Exact, non-floating comparison of a Razorpay-reported capture against
   * what this order should have been charged (Phase 13.3 §4). Currency is
   * compared as an exact string; amount as bigint paise via the same
   * decimalToPaise the checkout total was built with. Throws
   * PaymentMismatchError on ANY discrepancy so no caller can mark a
   * mismatched payment PAID.
   */
  assertCapturedPaymentMatchesOrder(
    order: Pick<Order, 'razorpayOrderId' | 'currency' | 'total'>,
    captured: {
      razorpayOrderId: string;
      amountPaise: bigint;
      currency: string;
    },
  ): void {
    if (
      order.razorpayOrderId &&
      captured.razorpayOrderId !== order.razorpayOrderId
    ) {
      throw new PaymentMismatchError(
        'RAZORPAY_ORDER_ID_MISMATCH',
        `expected ${order.razorpayOrderId}, got ${captured.razorpayOrderId}`,
      );
    }
    const expectedCurrency = order.currency || DEFAULT_CURRENCY;
    if (captured.currency !== expectedCurrency) {
      throw new PaymentMismatchError(
        'CURRENCY_MISMATCH',
        `expected ${expectedCurrency}, got ${captured.currency}`,
      );
    }
    const expectedPaise = decimalToPaise(order.total);
    if (captured.amountPaise !== expectedPaise) {
      throw new PaymentMismatchError(
        'AMOUNT_MISMATCH',
        `expected ${expectedPaise} paise, got ${captured.amountPaise} paise`,
      );
    }
  }

  private async applyFailed(
    tx: Prisma.TransactionClient,
    order: Order,
    attempt: PaymentAttempt,
    paymentEntity: RazorpayPaymentEntity,
  ): Promise<void> {
    const result = await tx.paymentAttempt.updateMany({
      where: {
        id: attempt.id,
        status: {
          notIn: [PaymentAttemptStatus.CAPTURED, PaymentAttemptStatus.FAILED],
        },
      },
      data: {
        status: PaymentAttemptStatus.FAILED,
        razorpayPaymentId: paymentEntity.id,
        failureCode: paymentEntity.error_code ?? null,
        failureReason: paymentEntity.error_description ?? null,
        method: paymentEntity.method,
      },
    });
    if (result.count !== 1) {
      return; // already terminal (captured or failed) — duplicate delivery, no-op
    }

    const transitioned = await this.transitionOrder(
      tx,
      order,
      OrderStatus.PAYMENT_FAILED,
      null,
      'Payment failed (webhook)',
    );
    if (transitioned) {
      await this.insertOutboxEvent(
        tx,
        'ORDER_STATUS_CHANGED',
        order,
        OrderStatus.PAYMENT_FAILED,
      );
    }
  }

  // ─── Reconciliation (Phase 13.3 — called only by PaymentReconciliationService) ──

  /**
   * Apply a captured Razorpay payment discovered by reconciliation (the
   * frontend `verify` callback never arrived AND no webhook was
   * processed). Same guarantees as the webhook capture path:
   *
   *  - amount / currency / razorpay-order-id verified EXACTLY first
   *    (assertCapturedPaymentMatchesOrder) — a mismatch returns 'MISMATCH'
   *    and transitions nothing;
   *  - the order row is SELECT ... FOR UPDATE-locked, so two instances
   *    that both fetched the same Razorpay payment serialize here and only
   *    one performs the transition (the other sees a non-pending status
   *    and no-ops);
   *  - the CAS on paymentAttempt + the partial unique index
   *    (`payment_attempts WHERE status='CAPTURED'`) are the ultimate
   *    single-writer backstop, identical to the webhook path;
   *  - the same OrderStatusHistory row + ORDER_PAID outbox event are
   *    written, once, on the branch that actually transitioned.
   *
   * The Razorpay API call itself happens in the caller, outside any
   * transaction (§13 preamble) — this method only takes the already-
   * fetched, normalized payment.
   */
  async reconcileCapturedPayment(
    order: Order,
    captured: {
      id: string;
      razorpayOrderId: string;
      amountPaise: bigint;
      currency: string;
      method?: string;
    },
  ): Promise<ReconcileCaptureResult> {
    try {
      this.assertCapturedPaymentMatchesOrder(order, {
        razorpayOrderId: captured.razorpayOrderId,
        amountPaise: captured.amountPaise,
        currency: captured.currency,
      });
    } catch (err) {
      if (err instanceof PaymentMismatchError) {
        this.logger.error(
          `Reconciliation mismatch for order ${order.id}: ${err.message} — NOT marking PAID`,
        );
        Sentry.captureException(err, {
          level: 'error',
          tags: { area: 'reconciliation_mismatch', reason: err.reason },
          extra: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            orderStatus: order.status,
            razorpayOrderId: order.razorpayOrderId ?? '',
            razorpayPaymentId: captured.id,
          },
        });
        return 'MISMATCH';
      }
      throw err;
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ status: OrderStatus }[]>`
          SELECT status FROM orders WHERE id = ${order.id} FOR UPDATE
        `;
        const current = locked[0];
        if (!current || current.status !== OrderStatus.PENDING_PAYMENT) {
          return 'ALREADY_TERMINAL';
        }
        const alreadyCaptured = await tx.paymentAttempt.findFirst({
          where: { orderId: order.id, status: PaymentAttemptStatus.CAPTURED },
        });
        if (alreadyCaptured) {
          return 'ALREADY_TERMINAL';
        }

        // Reuse the row for this payment id, or the latest still-open
        // attempt for this Razorpay order, or create one (webhook-before-
        // local-row case — §12.1).
        const existing = await tx.paymentAttempt.findFirst({
          where: {
            orderId: order.id,
            OR: [
              { razorpayPaymentId: captured.id },
              {
                razorpayOrderId: order.razorpayOrderId ?? undefined,
                status: PaymentAttemptStatus.INITIATED,
              },
            ],
          },
          orderBy: { createdAt: 'desc' },
        });
        const attemptId =
          existing?.id ??
          (
            await tx.paymentAttempt.create({
              data: {
                orderId: order.id,
                razorpayOrderId:
                  order.razorpayOrderId ?? captured.razorpayOrderId,
                amountPaise: captured.amountPaise,
                currency: captured.currency,
                status: PaymentAttemptStatus.INITIATED,
                // Derived from the order this attempt belongs to — never
                // a client-supplied value (Phase 4 W7 / P4-D2).
                tenantId: order.tenantId,
              },
            })
          ).id;

        const upd = await tx.paymentAttempt.updateMany({
          where: {
            id: attemptId,
            status: { not: PaymentAttemptStatus.CAPTURED },
          },
          data: {
            status: PaymentAttemptStatus.CAPTURED,
            razorpayPaymentId: captured.id,
            method: captured.method ?? null,
            capturedAt: new Date(),
          },
        });
        if (upd.count !== 1) {
          return 'ALREADY_TERMINAL';
        }

        const transitioned = await this.transitionOrder(
          tx,
          { ...order, status: current.status },
          OrderStatus.PAID,
          null,
          'Payment captured (reconciliation)',
        );
        if (transitioned) {
          await this.insertOutboxEvent(tx, 'ORDER_PAID', order);
        }
        return 'PAID';
      });
    } catch (err) {
      if (this.isUniqueConstraintViolation(err)) {
        // A concurrent webhook/verify captured a different attempt for
        // this order between our FOR UPDATE and the CAS — the partial
        // unique index rolled us back. Not our transition to make.
        this.logger.log(
          `reconcileCapturedPayment: order ${order.id} captured concurrently — no-op`,
        );
        return 'ALREADY_TERMINAL';
      }
      throw err;
    }
  }

  /**
   * Mark a genuinely-stale, still-unpaid order PAYMENT_FAILED (Phase 13.3
   * §5). Called by reconciliation ONLY after an authoritative Razorpay
   * `fetchOrderPayments` confirmed there is no captured/authorized payment
   * for this order and the order is past the give-up threshold.
   *
   * Uses the existing state machine: PENDING_PAYMENT -> PAYMENT_FAILED is a
   * legal transition (the customer can still retry it later, exactly as
   * after a real payment failure). Customer/checkout may separately cancel
   * an unpaid order (PENDING_PAYMENT/PAYMENT_FAILED -> CANCELLED) when the
   * cart has changed; reconciliation does not use that edge.
   */
  async failStalePendingOrder(order: Order): Promise<boolean> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ status: OrderStatus }[]>`
          SELECT status FROM orders WHERE id = ${order.id} FOR UPDATE
        `;
        const current = locked[0];
        if (!current || current.status !== OrderStatus.PENDING_PAYMENT) {
          return false;
        }
        // Never fail an order that somehow has a captured attempt.
        const captured = await tx.paymentAttempt.findFirst({
          where: { orderId: order.id, status: PaymentAttemptStatus.CAPTURED },
        });
        if (captured) {
          return false;
        }

        // Bookkeeping: any still-open attempt is now abandoned.
        await tx.paymentAttempt.updateMany({
          where: {
            orderId: order.id,
            status: PaymentAttemptStatus.INITIATED,
          },
          data: { status: PaymentAttemptStatus.ABANDONED },
        });

        const transitioned = await this.transitionOrder(
          tx,
          { ...order, status: current.status },
          OrderStatus.PAYMENT_FAILED,
          null,
          'Payment not completed — order expired by reconciliation (no captured Razorpay payment)',
        );
        if (transitioned) {
          await this.insertOutboxEvent(
            tx,
            'ORDER_STATUS_CHANGED',
            order,
            OrderStatus.PAYMENT_FAILED,
          );
        }
        return transitioned !== null;
      });
    } catch (err) {
      if (this.isUniqueConstraintViolation(err)) {
        return false;
      }
      throw err;
    }
  }

  // ─── Shared helpers ─────────────────────────────────────────────────────

  /**
   * CAS transition + history row, via the existing state machine (§14) —
   * never a hand-rolled status check. Returns the updated Order if this
   * call performed the transition, or null if it was already in the
   * target/another state (safe no-op — duplicate delivery or lost race).
   */
  private async transitionOrder(
    tx: Prisma.TransactionClient | PrismaService,
    order: Order,
    to: OrderStatus,
    changedByUserId: string | null,
    note: string,
  ): Promise<Order | null> {
    const from = order.status;
    if (!isTransitionAllowed(from, to)) {
      // Programmer error (a call site attempted an illegal transition) —
      // never a client-triggerable path given how call sites guard status
      // first, but never silently allowed either (§24 invariant 11).
      throw new ConflictException(`Illegal order transition ${from} -> ${to}`);
    }
    const cas = await tx.order.updateMany({
      where: { id: order.id, status: from },
      data: { status: to },
    });
    if (cas.count !== 1) {
      return null;
    }
    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        fromStatus: from,
        toStatus: to,
        changedByUserId,
        note,
        // Derived from the order being transitioned — never a
        // client-supplied value (Phase 4 W7 / P4-D2).
        tenantId: order.tenantId,
      },
    });
    if (to === OrderStatus.PAID) {
      await this.clearCartForPaidOrder(tx, order);
    }
    return { ...order, status: to };
  }

  private async clearCartForPaidOrder(
    tx: Prisma.TransactionClient | PrismaService,
    order: Order,
  ): Promise<void> {
    const cart = await tx.cart.findFirst({
      where: { userId: order.userId, tenantId: order.tenantId },
      select: { id: true },
    });
    if (!cart) return;
    const items = await tx.cartItem.findMany({
      where: { cartId: cart.id },
      select: { id: true },
    });
    if (items.length === 0) return;
    const itemIds = items.map((item) => item.id);
    await tx.cartItemCustomization.deleteMany({
      where: { cartItemId: { in: itemIds } },
    });
    await tx.cartItem.deleteMany({ where: { id: { in: itemIds } } });
  }

  /**
   * §12.2: insert only on the branch that actually performed the
   * transition (structurally that's at most once per order+transition,
   * since transitionOrder's own CAS already serializes who gets to call
   * this) — eventKey uniqueness is the backstop, not the primary
   * mechanism. Deliberately no try/catch: same reasoning as
   * applyCaptured's CAS above — swallowing a P2002 here wouldn't save the
   * surrounding transaction anyway (Postgres refuses to commit an already
   * -aborted transaction), it would just make the failure surface later
   * and less clearly. Let it propagate to the caller's outer catch.
   */
  private async insertOutboxEvent(
    tx: Prisma.TransactionClient,
    eventType: 'ORDER_PAID' | 'ORDER_STATUS_CHANGED',
    order: Order,
    toStatus?: OrderStatus,
  ): Promise<void> {
    const eventKey =
      eventType === 'ORDER_PAID'
        ? `ORDER_PAID:${order.id}`
        : `ORDER_STATUS_CHANGED:${order.id}:${toStatus}`;
    await tx.outboxEvent.create({
      data: {
        eventType,
        aggregateType: 'Order',
        aggregateId: order.id,
        eventKey,
        payload: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          userId: order.userId,
          ...(toStatus ? { toStatus } : {}),
        },
        status: 'PENDING',
      },
    });
  }

  /** Public: WebhookProcessor needs this to classify a transaction-rollback
   * cause as a harmless capture race rather than a genuine processing
   * failure (§ see applyCaptured's comment on why the catch lives there,
   * outside the transaction). */
  isUniqueConstraintViolation(err: unknown): boolean {
    return (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    );
  }
}
