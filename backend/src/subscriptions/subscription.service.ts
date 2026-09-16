import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Subscription } from '@prisma/client';
import { PrismaService } from '../common/database/prisma.service';
import { withTenantRlsContext } from '../common/tenant/tenant-rls';
import {
  assertSubscriptionTransitionAllowed,
  isSubscriptionTransitionAllowed,
} from './state-machine/subscription-state-machine';
import { NormalizedBillingEvent } from './billing-provider.interface';
import {
  ApplyScheduledDowngradeInput,
  CancelInput,
  ConfirmActivationInput,
  ConfirmRenewalInput,
  ConfirmUpgradeInput,
  ExhaustGraceInput,
  ExpireInput,
  ReactivateInput,
  RecordPaymentFailureInput,
  RecoverPaymentInput,
  ScheduleDowngradeInput,
  TransitionResult,
} from './subscription.types';

type Client = PrismaService | Prisma.TransactionClient;

/** Phase 7 — Cancellation Retention + Unscheduling wave
 * (docs/saas/DECISIONS.md P7-D3 Part D — "Cancellation retention duration =
 * 30 days"). The single ratified constant, consumed only by `cancel()`
 * below — never hardcoded a second time anywhere else in this file. */
const CANCELLATION_RETENTION_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Phase 7 — D7 SaaS Billing Webhooks wave (docs/saas/DECISIONS.md P7-D3
 * Part C — "Grace period = 7 days"). Consumed only by
 * `applyBillingWebhookEvent`'s `payment_failed` branch below — the sole
 * place a webhook-confirmed payment failure is turned into a `graceEndsAt`
 * value. (`findGraceExhaustedSubscriptions` above already reads whatever
 * `graceEndsAt` was written here — no scheduler change needed for this.) */
const GRACE_PERIOD_DAYS = 7;

/**
 * Phase 7 Stage 1 (docs/saas/DECISIONS.md P7-D1) — the subscription
 * transition service. Owns `Subscription.status`/`planId`/`pendingPlanId`/
 * period-field mutation and `SubscriptionEvent` history, exactly the way
 * `OrdersService`'s own transition methods own `Order.status`/
 * `OrderStatusHistory` — modeled directly on that file's
 * `transitionOrderWithHistory`/`adminTransitionStatus` pattern (CAS
 * update, idempotent same-state no-op, event written in the same
 * transaction, a lost race is a safe no-op never an error).
 *
 * **Provider-independent by construction.** This class has NO dependency
 * on `BillingProvider`/`FakeBillingProvider` and never calls one — every
 * method here represents "what happens once billing has already
 * confirmed something," never "go ask the provider." A future webhook
 * processor (not built in this stage — D7 remains OPEN) calls into this
 * service the same way a test calls it after driving
 * `FakeBillingProvider` — the split between "obtain confirmation" and
 * "persist the confirmed state" is exactly what keeps this service usable
 * regardless of which vendor is eventually chosen (P7-D1 Part G).
 *
 * **No entitlement coupling.** This file never imports or calls
 * `EntitlementService` and never duplicates its feature/limit/override
 * resolution logic (P7-D1 Part I) — `EntitlementService.resolve()`
 * already re-reads `Subscription` fresh on every call, so the moment a
 * transaction here commits, the next `resolve()` anywhere sees it. No
 * cache, no invalidation hook, nothing to bust.
 *
 * **Transaction convention.** Every method's first parameter is the
 * Prisma client to use — either the injected `PrismaService` or a
 * caller-supplied `Prisma.TransactionClient` — same explicit-client
 * convention `UsageService`/`common/tenant/tenant-lifecycle.ts` already
 * establish. This class never opens its own transaction from inside a
 * method that also accepts a `client` parameter. Every method's CAS
 * `updateMany` and its `SubscriptionEvent` insert always use the exact
 * same `client` instance — so when a CALLER passes a
 * `Prisma.TransactionClient` (wrapping this call, and whatever else it
 * needs, in one `prisma.$transaction`), the two writes commit or roll
 * back together (proven in
 * `test/e2e/subscription-lifecycle.e2e-spec.ts`'s own rollback test).
 * Called with the bare `PrismaService` directly (as this stage's own
 * tests mostly do, since no higher-level composing caller exists yet),
 * each write is its own separate auto-committed statement — exactly
 * `UsageService.reserve()`'s own long-established contract, not a
 * weaker guarantee invented here.
 */
@Injectable()
export class SubscriptionService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Reads ──────────────────────────────────────────────────────────────

  /** Tenant-scoped by construction — `Subscription.tenantId` is `@unique`,
   * so this can never return another tenant's row. The caller (a future
   * controller) is responsible for deriving `tenantId` from the existing
   * server-side tenant-context mechanism, never from client input — this
   * method takes it as an already-trusted value, the same posture
   * `EntitlementService.resolve(tenantId)` already has. */
  async getSubscriptionForTenant(
    client: Client,
    tenantId: string,
  ): Promise<Subscription> {
    const subscription = await this.findSubscriptionForTenant(client, tenantId);
    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }
    return subscription;
  }

  /**
   * Phase 7 Stage 2 (docs/saas/DECISIONS.md P7-D2, Step 5) addition — same
   * tenant-scoping as `getSubscriptionForTenant` above, but returns `null`
   * instead of throwing when none exists. Added specifically so
   * `SubscriptionOrchestrationService.createSubscription()` can check
   * "does this tenant already have a subscription?" without a raw
   * `this.prisma.subscription...` call of its own.
   *
   * Unlike every OTHER `client.subscription...` call in this file, this
   * one is reachable from `CheckoutService.checkout()`'s own `tx` — a
   * plain transaction with no RLS GUC of its own. `subscriptions` carries
   * FORCE RLS (D4; `prisma/migrations/…_enable_rls_tenancy_tables`), so a
   * bare `client.subscription.findUnique` silently sees zero rows there
   * (fail-closed) and checkout's `orders_per_month` limit check misreports
   * "billing_period_unavailable" for a tenant that has a perfectly good
   * subscription. Routed through `withTenantRlsContext` (dynamic delegate
   * access, same idiom `scopedSubscriptionFindUnique` in tenant-prisma.ts
   * already uses, and for the same reason: it keeps this call off the
   * tenant-data-access guard's `tx.subscription` pattern without actually
   * bypassing RLS) so it works whether `client` is a bare `PrismaService`
   * or an already-open `TransactionClient`.
   */
  async findSubscriptionForTenant(
    client: Client,
    tenantId: string,
  ): Promise<Subscription | null> {
    return withTenantRlsContext(client, tenantId, async (tx) => {
      const delegate = tx[
        'subscription' as keyof Prisma.TransactionClient
      ] as unknown as {
        findUnique: (args: unknown) => Promise<Subscription | null>;
      };
      return delegate.findUnique({ where: { tenantId } });
    });
  }

  /**
   * Phase 7 scheduler wave — system-initiated, cross-tenant reads used
   * ONLY by `SubscriptionSchedulerService`. Never exposed to any
   * tenant-facing caller, never accepts (or trusts) an externally-supplied
   * tenantId — the scheduler has no external input at all; eligibility is
   * derived entirely from what Postgres itself reports. Bounded (`take:
   * limit`) — same discipline `PaymentReconciliationService.
   * findReconcileCandidates()` already established ("never query for
   * every row"). Both are pure reads: no `.update`/`.create` here: the
   * actual mutation is still `SubscriptionService.exhaustGrace()`/
   * `SubscriptionOrchestrationService.reconcilePeriod()`'s own job, this
   * file's own state-machine-owning methods, unduplicated.
   */
  async findGraceExhaustedSubscriptions(
    client: Client,
    now: Date,
    limit: number,
  ): Promise<Subscription[]> {
    return client.subscription.findMany({
      where: { status: 'PAST_DUE', graceEndsAt: { lte: now } },
      orderBy: { graceEndsAt: 'asc' },
      take: limit,
    });
  }

  /**
   * Candidates for `SubscriptionOrchestrationService.reconcilePeriod()` —
   * `ACTIVE`, provider-linked, and past their LOCALLY known
   * `currentPeriodEnd`. This is a cheap local pre-filter only; whether the
   * period boundary is actually, provider-confirmed reached is
   * `reconcilePeriod()`'s own job (it re-checks against a fresh
   * `getSubscription()` call) — this query exists solely so the scheduler
   * never calls the billing provider for a subscription that plainly
   * hasn't reached its own recorded period end yet.
   */
  async findSubscriptionsNeedingPeriodReconciliation(
    client: Client,
    now: Date,
    limit: number,
  ): Promise<Subscription[]> {
    return client.subscription.findMany({
      where: {
        status: 'ACTIVE',
        providerSubscriptionId: { not: null },
        currentPeriodEnd: { lte: now },
      },
      orderBy: { currentPeriodEnd: 'asc' },
      take: limit,
    });
  }

  /**
   * Phase 7 — Cancellation Retention + Unscheduling wave
   * (docs/saas/DECISIONS.md P7-D3 Part D). Candidates for
   * `SubscriptionService.expire()` — `CANCELLED` with an elapsed
   * `retentionEndsAt`. Same bounded/ordered shape as
   * `findGraceExhaustedSubscriptions` above. A subscription this method
   * has already surfaced and `expire()` has already advanced to
   * `EXPIRED` naturally stops matching `status: 'CANCELLED'` on the next
   * call — no separate "already processed" tracking is needed.
   */
  async findExpirableCancelledSubscriptions(
    client: Client,
    now: Date,
    limit: number,
  ): Promise<Subscription[]> {
    return client.subscription.findMany({
      where: { status: 'CANCELLED', retentionEndsAt: { lte: now } },
      orderBy: { retentionEndsAt: 'asc' },
      take: limit,
    });
  }

  /**
   * Phase 7 — D7 SaaS Billing Webhooks wave. Provider-initiated lookup —
   * used ONLY by `BillingWebhookProcessor` to resolve which local
   * subscription an inbound webhook event refers to, tried first (P7-D3
   * Part B: "resolve subscription/tenant using
   * providerSubscriptionId/providerCustomerId"). `providerSubscriptionId`
   * is `@unique`, so this returns at most one row; never trusts a
   * caller-supplied `tenantId` — the tenant is whatever tenant this
   * uniquely-identified subscription actually belongs to, nothing a
   * webhook payload could ever assert directly.
   */
  async findSubscriptionByProviderSubscriptionId(
    client: Client,
    providerSubscriptionId: string,
  ): Promise<Subscription | null> {
    return client.subscription.findUnique({
      where: { providerSubscriptionId },
    });
  }

  /**
   * Phase 7 — D7 SaaS Billing Webhooks wave. Same role as
   * `findSubscriptionByProviderSubscriptionId` above, tried as the
   * fallback when an event carries only a `providerCustomerId` (P7-D3
   * Part B). `providerCustomerId` is likewise `@unique` on `Subscription`.
   */
  async findSubscriptionByProviderCustomerId(
    client: Client,
    providerCustomerId: string,
  ): Promise<Subscription | null> {
    return client.subscription.findUnique({
      where: { providerCustomerId },
    });
  }

  // ─── Creation ───────────────────────────────────────────────────────────

  /**
   * The one place a `Subscription` row is born via this service — always
   * at `PENDING`, per the ratified matrix's own framing ("PENDING ->
   * TRIALING or PENDING -> ACTIVE occurs only after confirmed billing").
   * Does not conflict with the pre-existing seed-script upsert path
   * (`seed-tenant-bootstrap.ts`/`dev-scratch-seed-phase2b-equivalent.ts`,
   * both unmodified) — `Subscription.tenantId` is `@unique`, so a tenant
   * already seeded with a direct `ACTIVE` row simply can't also go
   * through this method; that is a real, intentional uniqueness
   * constraint, not a bug to route around.
   */
  async createPendingSubscription(
    client: Client,
    tenantId: string,
    planId: string,
  ): Promise<Subscription> {
    const created = await client.subscription.create({
      data: { tenantId, planId, status: 'PENDING', updatedAt: new Date() },
    });
    await client.subscriptionEvent.create({
      data: {
        subscriptionId: created.id,
        tenantId,
        type: 'created',
        fromStatus: null,
        toStatus: 'PENDING',
        toPlanId: planId,
        metadata: {},
      },
    });
    return created;
  }

  // ─── Activation (PENDING/TRIALING -> TRIALING/ACTIVE) ───────────────────

  /** PENDING -> TRIALING, PENDING -> ACTIVE, or TRIALING -> ACTIVE — always
   * a confirmed-billing event, never optimistic (P7-D1 Part B). Idempotent:
   * calling this again once already at `toStatus` is a safe no-op (the
   * same duplicate-provider-event replay `order-lifecycle.util.ts`'s own
   * convention handles via a same-state early return). */
  async confirmActivation(
    client: Client,
    subscription: Subscription,
    input: ConfirmActivationInput,
  ): Promise<TransitionResult<Subscription>> {
    if (subscription.status === input.toStatus) {
      return { applied: false, subscription, eventType: null };
    }
    assertSubscriptionTransitionAllowed(subscription.status, input.toStatus);

    const cas = await client.subscription.updateMany({
      where: { id: subscription.id, status: subscription.status },
      data: {
        status: input.toStatus,
        currentPeriodStart: input.currentPeriodStart,
        currentPeriodEnd: input.currentPeriodEnd,
        providerCustomerId: input.providerCustomerId,
        providerSubscriptionId: input.providerSubscriptionId,
        trialEndsAt: input.trialEndsAt,
        updatedAt: new Date(),
      },
    });
    if (cas.count !== 1) {
      return { applied: false, subscription, eventType: null };
    }

    await client.subscriptionEvent.create({
      data: {
        subscriptionId: subscription.id,
        tenantId: subscription.tenantId,
        type: 'activated',
        fromStatus: subscription.status,
        toStatus: input.toStatus,
        toPlanId: subscription.planId,
        providerEventId: input.providerEventId,
        metadata: {},
      },
    });
    const updated = await client.subscription.findUniqueOrThrow({
      where: { id: subscription.id },
    });
    return { applied: true, subscription: updated, eventType: 'activated' };
  }

  // ─── Payment failure / recovery / grace exhaustion ──────────────────────

  /** ACTIVE|TRIALING -> PAST_DUE. Idempotent: a duplicate failure webhook
   * for an already-PAST_DUE subscription never extends `graceEndsAt`
   * again — same field, same value, no second event. */
  async recordPaymentFailure(
    client: Client,
    subscription: Subscription,
    input: RecordPaymentFailureInput,
  ): Promise<TransitionResult<Subscription>> {
    if (subscription.status === 'PAST_DUE') {
      return { applied: false, subscription, eventType: null };
    }
    assertSubscriptionTransitionAllowed(subscription.status, 'PAST_DUE');

    const cas = await client.subscription.updateMany({
      where: { id: subscription.id, status: subscription.status },
      data: {
        status: 'PAST_DUE',
        graceEndsAt: input.graceEndsAt,
        updatedAt: new Date(),
      },
    });
    if (cas.count !== 1) {
      return { applied: false, subscription, eventType: null };
    }

    await client.subscriptionEvent.create({
      data: {
        subscriptionId: subscription.id,
        tenantId: subscription.tenantId,
        type: 'payment_failed',
        fromStatus: subscription.status,
        toStatus: 'PAST_DUE',
        providerEventId: input.providerEventId,
        metadata: {},
      },
    });
    const updated = await client.subscription.findUniqueOrThrow({
      where: { id: subscription.id },
    });
    return {
      applied: true,
      subscription: updated,
      eventType: 'payment_failed',
    };
  }

  /** PAST_DUE|PAUSED -> ACTIVE on confirmed recovery only — never
   * optimistic. Clears `graceEndsAt`. Idempotent if already `ACTIVE`. */
  async recoverPayment(
    client: Client,
    subscription: Subscription,
    input: RecoverPaymentInput,
  ): Promise<TransitionResult<Subscription>> {
    if (subscription.status === 'ACTIVE') {
      return { applied: false, subscription, eventType: null };
    }
    assertSubscriptionTransitionAllowed(subscription.status, 'ACTIVE');

    const cas = await client.subscription.updateMany({
      where: { id: subscription.id, status: subscription.status },
      data: { status: 'ACTIVE', graceEndsAt: null, updatedAt: new Date() },
    });
    if (cas.count !== 1) {
      return { applied: false, subscription, eventType: null };
    }

    await client.subscriptionEvent.create({
      data: {
        subscriptionId: subscription.id,
        tenantId: subscription.tenantId,
        type: 'resumed',
        fromStatus: subscription.status,
        toStatus: 'ACTIVE',
        providerEventId: input.providerEventId,
        metadata: {},
      },
    });
    const updated = await client.subscription.findUniqueOrThrow({
      where: { id: subscription.id },
    });
    return { applied: true, subscription: updated, eventType: 'resumed' };
  }

  /** PAST_DUE -> PAUSED, once grace is exhausted. `graceEndsAt` is the
   * authoritative signal for WHEN this should happen (P7-D1 Part C) — this
   * method performs the transition once told to; deciding the exact
   * moment (comparing `now()` to `graceEndsAt`) is the CALLER's
   * responsibility (a future scheduler/job, not invented here — no cron,
   * no hardcoded duration exists anywhere in this file). Idempotent if
   * already `PAUSED`. */
  async exhaustGrace(
    client: Client,
    subscription: Subscription,
    input: ExhaustGraceInput,
  ): Promise<TransitionResult<Subscription>> {
    if (subscription.status === 'PAUSED') {
      return { applied: false, subscription, eventType: null };
    }
    assertSubscriptionTransitionAllowed(subscription.status, 'PAUSED');

    const cas = await client.subscription.updateMany({
      where: { id: subscription.id, status: subscription.status },
      data: { status: 'PAUSED', updatedAt: new Date() },
    });
    if (cas.count !== 1) {
      return { applied: false, subscription, eventType: null };
    }

    await client.subscriptionEvent.create({
      data: {
        subscriptionId: subscription.id,
        tenantId: subscription.tenantId,
        type: 'paused',
        fromStatus: subscription.status,
        toStatus: 'PAUSED',
        providerEventId: input.providerEventId,
        metadata: {},
      },
    });
    const updated = await client.subscription.findUniqueOrThrow({
      where: { id: subscription.id },
    });
    return { applied: true, subscription: updated, eventType: 'paused' };
  }

  // ─── Upgrade / downgrade ─────────────────────────────────────────────────

  /**
   * ACTIVE -> ACTIVE, confirmed immediate plan raise only — never
   * optimistic (P7-D1 Part B/§6). `planId` never changes merely because an
   * upgrade was requested; this method IS the "after confirmation" step.
   * The CAS guard includes the currently-known `planId`, not just
   * `status` — two concurrent upgrade attempts can never silently
   * clobber each other (the second one's `updateMany` affects zero rows
   * once the first commits, and is reported as a safe no-op, not an
   * error). Idempotent if `planId` already equals `toPlanId`.
   */
  async confirmUpgrade(
    client: Client,
    subscription: Subscription,
    input: ConfirmUpgradeInput,
  ): Promise<TransitionResult<Subscription>> {
    if (subscription.planId === input.toPlanId) {
      return { applied: false, subscription, eventType: null };
    }
    this.assertCurrentlyActive(subscription);
    await this.assertPlanExists(client, input.toPlanId);

    const cas = await client.subscription.updateMany({
      where: {
        id: subscription.id,
        status: subscription.status,
        planId: subscription.planId,
      },
      data: { planId: input.toPlanId, updatedAt: new Date() },
    });
    if (cas.count !== 1) {
      return { applied: false, subscription, eventType: null };
    }

    await client.subscriptionEvent.create({
      data: {
        subscriptionId: subscription.id,
        tenantId: subscription.tenantId,
        type: 'upgraded',
        fromStatus: subscription.status,
        toStatus: subscription.status,
        fromPlanId: subscription.planId,
        toPlanId: input.toPlanId,
        providerEventId: input.providerEventId,
        metadata: {},
      },
    });
    const updated = await client.subscription.findUniqueOrThrow({
      where: { id: subscription.id },
    });
    return { applied: true, subscription: updated, eventType: 'upgraded' };
  }

  /**
   * ACTIVE -> ACTIVE, downgrade SCHEDULING only — `planId`/`status` are
   * NEVER touched here (P7-D1 Part B/§6: "do not immediately change
   * planId… retain current entitlements until period boundary"). Only
   * `pendingPlanId` is set; the tenant's effective plan (via
   * `EntitlementService`) is completely unaffected until
   * `applyScheduledDowngrade` runs at the confirmed period boundary. No
   * provider confirmation is required to SCHEDULE a downgrade (the
   * request itself is the confirmed action, per §6) — `providerEventId`
   * is therefore not accepted here at all. Idempotent if `pendingPlanId`
   * already equals the requested target.
   */
  async scheduleDowngrade(
    client: Client,
    subscription: Subscription,
    input: ScheduleDowngradeInput,
  ): Promise<TransitionResult<Subscription>> {
    if (subscription.pendingPlanId === input.pendingPlanId) {
      return { applied: false, subscription, eventType: null };
    }
    this.assertCurrentlyActive(subscription);
    await this.assertPlanExists(client, input.pendingPlanId);

    const cas = await client.subscription.updateMany({
      where: {
        id: subscription.id,
        status: subscription.status,
        pendingPlanId: subscription.pendingPlanId,
      },
      data: { pendingPlanId: input.pendingPlanId, updatedAt: new Date() },
    });
    if (cas.count !== 1) {
      return { applied: false, subscription, eventType: null };
    }

    await client.subscriptionEvent.create({
      data: {
        subscriptionId: subscription.id,
        tenantId: subscription.tenantId,
        type: 'downgrade_scheduled',
        fromStatus: subscription.status,
        toStatus: subscription.status,
        fromPlanId: subscription.planId,
        toPlanId: input.pendingPlanId,
        metadata: {},
      },
    });
    const updated = await client.subscription.findUniqueOrThrow({
      where: { id: subscription.id },
    });
    return {
      applied: true,
      subscription: updated,
      eventType: 'downgrade_scheduled',
    };
  }

  /**
   * ACTIVE -> ACTIVE, applying a previously-scheduled downgrade at the
   * confirmed period boundary (P7-D1 Part B/§6/§7) — `planId :=
   * pendingPlanId`, `pendingPlanId` cleared, period fields updated to the
   * provider-confirmed new period. Never deletes or touches any tenant
   * resource (products/coupons/team members/uploads) — only
   * `Subscription`'s own fields change; existing over-limit resources are
   * left exactly as they are (Phase 6's own enforcement governs FUTURE
   * creates, per the existing `assertLimit` design — untouched here).
   * A no-op (nothing scheduled) if `pendingPlanId` is already `null`.
   */
  async applyScheduledDowngrade(
    client: Client,
    subscription: Subscription,
    input: ApplyScheduledDowngradeInput,
  ): Promise<TransitionResult<Subscription>> {
    if (subscription.pendingPlanId === null) {
      return { applied: false, subscription, eventType: null };
    }
    this.assertCurrentlyActive(subscription);

    const cas = await client.subscription.updateMany({
      where: {
        id: subscription.id,
        status: subscription.status,
        pendingPlanId: subscription.pendingPlanId,
      },
      data: {
        planId: subscription.pendingPlanId,
        pendingPlanId: null,
        currentPeriodStart: input.currentPeriodStart,
        currentPeriodEnd: input.currentPeriodEnd,
        updatedAt: new Date(),
      },
    });
    if (cas.count !== 1) {
      return { applied: false, subscription, eventType: null };
    }

    await client.subscriptionEvent.create({
      data: {
        subscriptionId: subscription.id,
        tenantId: subscription.tenantId,
        type: 'downgrade_applied',
        fromStatus: subscription.status,
        toStatus: subscription.status,
        fromPlanId: subscription.planId,
        toPlanId: subscription.pendingPlanId,
        providerEventId: input.providerEventId,
        metadata: {},
      },
    });
    const updated = await client.subscription.findUniqueOrThrow({
      where: { id: subscription.id },
    });
    return {
      applied: true,
      subscription: updated,
      eventType: 'downgrade_applied',
    };
  }

  // ─── Plain period renewal (Phase 7 — Wave A) ─────────────────────────────

  /**
   * Phase 7 — Wave A: Plain Period Renewal Fix. ACTIVE -> ACTIVE,
   * provider-confirmed plain billing-period renewal — the boundary was
   * reached and the provider confirms the subscription is still ACTIVE
   * with NOTHING else pending (no scheduled downgrade, no scheduled
   * cancellation; the orchestration layer is responsible for trying
   * those two paths first and only reaching this method when neither
   * applied — see `SubscriptionOrchestrationService.reconcilePeriod`'s
   * own updated comment). Refreshes ONLY `currentPeriodStart`/
   * `currentPeriodEnd` — `status`/`planId`/`cancelAtPeriodEnd`/
   * `pendingPlanId`/`graceEndsAt`/`retentionEndsAt` are never touched
   * here, exactly as every other transition method here only ever
   * touches the fields it specifically owns.
   *
   * **Not folded into `applyScheduledDowngrade`**: that method's own
   * idempotency/CAS guard keys off `pendingPlanId` (a plain renewal has
   * none) and it always writes a plan change; reusing it for a
   * no-plan-change renewal would either require `pendingPlanId` to be
   * spuriously non-null or would silently skip the CAS guard entirely —
   * a distinct method with its own CAS guard (on `currentPeriodStart`
   * itself) is the correct, minimal-footprint shape.
   *
   * **Idempotent by provider-period comparison**: if the given
   * `input.currentPeriodStart` already equals what's stored locally,
   * this is a safe no-op — no duplicate renewal event is ever written
   * for the same confirmed period (satisfies "a repeated reconciliation
   * for the same provider period must not create duplicate renewal
   * events"). The CAS `updateMany` additionally guards on the CURRENT
   * `currentPeriodStart` value, so two concurrent callers (two
   * overlapping reconciliation ticks, or a reconciliation racing a
   * future webhook-driven renewal) can never both advance the period —
   * the second one's `updateMany` affects zero rows and returns the
   * same safe no-op, never a corrupted intermediate state.
   *
   * **Event type: reuses `activated`, not a new `renewed`/`period_
   * renewed` value.** Per the same migration-safety-guard reasoning
   * `scheduleCancellation`/`unscheduleCancellation` above already
   * document (P7-D3 Part H's reuse-by-default policy) — a new enum
   * value needs `ALTER TYPE ... ADD VALUE` on a type created by an
   * EARLIER migration, which the additive-only guard rejects for any
   * non-legacy migration. Disambiguated from a real PENDING/TRIALING ->
   * ACTIVE activation by `fromStatus === toStatus` (an activation always
   * has a real status change) and by `metadata.renewal: true`.
   */
  async confirmRenewal(
    client: Client,
    subscription: Subscription,
    input: ConfirmRenewalInput,
  ): Promise<TransitionResult<Subscription>> {
    if (
      subscription.currentPeriodStart !== null &&
      subscription.currentPeriodStart.getTime() ===
        input.currentPeriodStart.getTime()
    ) {
      return { applied: false, subscription, eventType: null };
    }
    this.assertCurrentlyActive(subscription);

    const cas = await client.subscription.updateMany({
      where: {
        id: subscription.id,
        status: subscription.status,
        currentPeriodStart: subscription.currentPeriodStart,
      },
      data: {
        currentPeriodStart: input.currentPeriodStart,
        currentPeriodEnd: input.currentPeriodEnd,
        updatedAt: new Date(),
      },
    });
    if (cas.count !== 1) {
      return { applied: false, subscription, eventType: null };
    }

    await client.subscriptionEvent.create({
      data: {
        subscriptionId: subscription.id,
        tenantId: subscription.tenantId,
        type: 'activated',
        fromStatus: subscription.status,
        toStatus: subscription.status,
        providerEventId: input.providerEventId,
        metadata: { renewal: true },
      },
    });
    const updated = await client.subscription.findUniqueOrThrow({
      where: { id: subscription.id },
    });
    return { applied: true, subscription: updated, eventType: 'activated' };
  }

  // ─── Cancellation scheduling (Stage 2, docs/saas/DECISIONS.md P7-D2 Part C) ──

  /**
   * ACTIVE -> ACTIVE, cancellation SCHEDULING only — `status`/`planId` are
   * NEVER touched here, only `cancelAtPeriodEnd` (P7-D2 Part C: "the
   * local subscription remains ACTIVE... no immediate entitlement
   * reduction and no immediate transition to CANCELLED"). Mirrors
   * `scheduleDowngrade`'s own shape exactly. Applying a scheduled
   * cancellation at the confirmed period boundary is NOT a separate
   * method — per P7-D2 Part B, that is the ordinary `cancel()` transition
   * below (now legal from `ACTIVE` too), called by the orchestration
   * layer once the provider confirms the boundary has been reached;
   * `cancelAtPeriodEnd` itself is left as `true` afterward (a harmless,
   * historically-accurate flag on an already-`CANCELLED` row — this
   * method never needs to clear it, and `cancel()` never touches it
   * either, exactly as `applyScheduledDowngrade` leaves `pendingPlanId`
   * cleared but `cancel()`/every other method leaves fields it doesn't
   * own alone). No provider confirmation is required to persist THIS
   * scheduling step at the local-state-machine layer (same reasoning as
   * `scheduleDowngrade`: the request itself is the confirmed local
   * action) — P7-D2 Part D's "require provider acceptance before
   * persisting" requirement is an ORCHESTRATION-layer sequencing rule
   * (call the provider first, only call this method after it accepts),
   * not a parameter this persistence method itself needs to accept.
   * Idempotent if `cancelAtPeriodEnd` is already `true`.
   *
   * **Event type: reuses `cancelled`, not a dedicated
   * `cancellation_scheduled` value.** A new enum value would need
   * `ALTER TYPE "SubscriptionEventType" ADD VALUE ...` on a type created
   * by an EARLIER migration — `migration-safety.spec.ts`'s additive-only
   * guard (G-10) rejects that shape outright for any non-legacy
   * migration (confirmed empirically: the one existing
   * `WebhookEventStatus ADD VALUE 'FAILED'` precedent is grandfathered
   * by filename, not permitted by a general rule). Extending the guard
   * to allow it is a separate, not-yet-ratified architectural decision
   * (the same weight P4-D2/P4-D3's own dedicated guard-extension records
   * carried), out of scope here — so this event reuses the existing
   * `cancelled` type instead of adding a new one, disambiguated from an
   * ACTUAL cancellation by `toStatus` staying equal to the current
   * (unchanged) `status` and by `metadata.scheduled: true`. A real
   * cancellation (via `cancel()` below) always has `toStatus:
   * 'CANCELLED'`; this scheduling event never does.
   */
  async scheduleCancellation(
    client: Client,
    subscription: Subscription,
  ): Promise<TransitionResult<Subscription>> {
    if (subscription.cancelAtPeriodEnd === true) {
      return { applied: false, subscription, eventType: null };
    }
    this.assertCurrentlyActive(subscription);

    const cas = await client.subscription.updateMany({
      where: {
        id: subscription.id,
        status: subscription.status,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      },
      data: { cancelAtPeriodEnd: true, updatedAt: new Date() },
    });
    if (cas.count !== 1) {
      return { applied: false, subscription, eventType: null };
    }

    await client.subscriptionEvent.create({
      data: {
        subscriptionId: subscription.id,
        tenantId: subscription.tenantId,
        type: 'cancelled',
        fromStatus: subscription.status,
        toStatus: subscription.status,
        metadata: { scheduled: true },
      },
    });
    const updated = await client.subscription.findUniqueOrThrow({
      where: { id: subscription.id },
    });
    return {
      applied: true,
      subscription: updated,
      eventType: 'cancelled',
    };
  }

  /**
   * Phase 7 — Cancellation Retention + Unscheduling wave
   * (docs/saas/DECISIONS.md P7-D3 Part E). ACTIVE -> ACTIVE, the exact
   * reverse of `scheduleCancellation()` above — flips `cancelAtPeriodEnd`
   * back to `false`, `status`/`planId` untouched. Only reachable while
   * `ACTIVE` and only meaningful while a cancellation is actually
   * scheduled (`cancelAtPeriodEnd === true`); idempotent no-op otherwise
   * (already unscheduled, or nothing was ever scheduled). No provider
   * confirmation is modeled at THIS persistence layer — per the same
   * pattern `scheduleDowngrade`/`scheduleCancellation` already establish,
   * "call the provider first, only persist after it accepts" is an
   * ORCHESTRATION-layer sequencing rule
   * (`SubscriptionOrchestrationService`'s own job), not a parameter this
   * method itself needs. Reuses the existing `cancelled` event type with
   * `metadata: { unscheduled: true }` — no new `SubscriptionEventType`
   * value (P7-D3 Part H's own reuse-by-default policy).
   */
  async unscheduleCancellation(
    client: Client,
    subscription: Subscription,
  ): Promise<TransitionResult<Subscription>> {
    if (subscription.cancelAtPeriodEnd !== true) {
      return { applied: false, subscription, eventType: null };
    }
    this.assertCurrentlyActive(subscription);

    const cas = await client.subscription.updateMany({
      where: {
        id: subscription.id,
        status: subscription.status,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      },
      data: { cancelAtPeriodEnd: false, updatedAt: new Date() },
    });
    if (cas.count !== 1) {
      return { applied: false, subscription, eventType: null };
    }

    await client.subscriptionEvent.create({
      data: {
        subscriptionId: subscription.id,
        tenantId: subscription.tenantId,
        type: 'cancelled',
        fromStatus: subscription.status,
        toStatus: subscription.status,
        metadata: { unscheduled: true },
      },
    });
    const updated = await client.subscription.findUniqueOrThrow({
      where: { id: subscription.id },
    });
    return {
      applied: true,
      subscription: updated,
      eventType: 'cancelled',
    };
  }

  // ─── Cancellation / reactivation / expiry ────────────────────────────────

  /** PAST_DUE|PAUSED|ACTIVE -> CANCELLED. `ACTIVE -> CANCELLED` (immediate
   * tenant-requested cancellation) was added to the ratified matrix by
   * docs/saas/DECISIONS.md P7-D2 Part B — an explicit, intentional
   * amendment to P7-D1 Part B, which originally allowed only
   * `PAST_DUE`/`PAUSED` as sources (see `subscription-state-machine.ts`'s
   * own updated comment). This same method also serves as "apply a
   * previously-scheduled at-period-end cancellation" — see
   * `scheduleCancellation` above; the orchestration layer calls this
   * method for BOTH an immediate cancellation and a scheduled one reaching
   * its confirmed boundary, since both are the identical `ACTIVE ->
   * CANCELLED` transition. Retains all tenant data — no deletion of any
   * kind. Idempotent if already `CANCELLED`.
   *
   * **`retentionEndsAt` (docs/saas/DECISIONS.md P7-D3 Part D)** is
   * established HERE, in the same CAS update that sets `status:
   * 'CANCELLED'` — and nowhere else. This is deliberate: since this is the
   * ONE method that performs the actual `-> CANCELLED` transition
   * (`scheduleCancellation()` above never changes `status` at all — it
   * only flips `cancelAtPeriodEnd`), retention correctly starts at the
   * moment cancellation is genuinely effective, for BOTH an immediate
   * cancellation and a scheduled one applied later by the orchestration
   * layer's `reconcilePeriod()` — with no special-casing needed to tell
   * the two apart. */
  async cancel(
    client: Client,
    subscription: Subscription,
    input: CancelInput,
  ): Promise<TransitionResult<Subscription>> {
    if (subscription.status === 'CANCELLED') {
      return { applied: false, subscription, eventType: null };
    }
    assertSubscriptionTransitionAllowed(subscription.status, 'CANCELLED');

    const now = new Date();
    const retentionEndsAt = new Date(
      now.getTime() + CANCELLATION_RETENTION_DAYS * MS_PER_DAY,
    );
    const cas = await client.subscription.updateMany({
      where: { id: subscription.id, status: subscription.status },
      data: { status: 'CANCELLED', retentionEndsAt, updatedAt: now },
    });
    if (cas.count !== 1) {
      return { applied: false, subscription, eventType: null };
    }

    await client.subscriptionEvent.create({
      data: {
        subscriptionId: subscription.id,
        tenantId: subscription.tenantId,
        type: 'cancelled',
        fromStatus: subscription.status,
        toStatus: 'CANCELLED',
        providerEventId: input.providerEventId,
        metadata: {},
      },
    });
    const updated = await client.subscription.findUniqueOrThrow({
      where: { id: subscription.id },
    });
    return { applied: true, subscription: updated, eventType: 'cancelled' };
  }

  /** CANCELLED -> ACTIVE, confirmed reactivation/billing only — never
   * optimistic, and only reachable before `EXPIRED` (the allowlist itself
   * enforces this: there is no `EXPIRED -> ACTIVE` edge). Idempotent if
   * already `ACTIVE`. */
  async reactivate(
    client: Client,
    subscription: Subscription,
    input: ReactivateInput,
  ): Promise<TransitionResult<Subscription>> {
    if (subscription.status === 'ACTIVE') {
      return { applied: false, subscription, eventType: null };
    }
    assertSubscriptionTransitionAllowed(subscription.status, 'ACTIVE');

    const cas = await client.subscription.updateMany({
      where: { id: subscription.id, status: subscription.status },
      data: { status: 'ACTIVE', updatedAt: new Date() },
    });
    if (cas.count !== 1) {
      return { applied: false, subscription, eventType: null };
    }

    await client.subscriptionEvent.create({
      data: {
        subscriptionId: subscription.id,
        tenantId: subscription.tenantId,
        type: 'reactivated',
        fromStatus: subscription.status,
        toStatus: 'ACTIVE',
        providerEventId: input.providerEventId,
        metadata: {},
      },
    });
    const updated = await client.subscription.findUniqueOrThrow({
      where: { id: subscription.id },
    });
    return {
      applied: true,
      subscription: updated,
      eventType: 'reactivated',
    };
  }

  /** PAUSED|CANCELLED -> EXPIRED, terminal (P7-D1 Part B/D — the exact
   * retention window that should trigger this call is NOT decided or
   * hardcoded anywhere in this file; a future job/decision owns that
   * timing). Retains all tenant data and subscription history — no
   * deletion of any kind is performed here or implied by this
   * transition. Idempotent if already `EXPIRED`; calling anything else on
   * an `EXPIRED` subscription fails the allowlist (`EXPIRED: []`), never
   * silently succeeds. */
  async expire(
    client: Client,
    subscription: Subscription,
    input: ExpireInput,
  ): Promise<TransitionResult<Subscription>> {
    if (subscription.status === 'EXPIRED') {
      return { applied: false, subscription, eventType: null };
    }
    assertSubscriptionTransitionAllowed(subscription.status, 'EXPIRED');

    const cas = await client.subscription.updateMany({
      where: { id: subscription.id, status: subscription.status },
      data: { status: 'EXPIRED', updatedAt: new Date() },
    });
    if (cas.count !== 1) {
      return { applied: false, subscription, eventType: null };
    }

    await client.subscriptionEvent.create({
      data: {
        subscriptionId: subscription.id,
        tenantId: subscription.tenantId,
        type: 'expired',
        fromStatus: subscription.status,
        toStatus: 'EXPIRED',
        providerEventId: input.providerEventId,
        metadata: {},
      },
    });
    const updated = await client.subscription.findUniqueOrThrow({
      where: { id: subscription.id },
    });
    return { applied: true, subscription: updated, eventType: 'expired' };
  }

  // ─── Provider webhook entry point (Phase 7 — D7 SaaS Billing Webhooks) ──

  /**
   * The SOLE entry point `BillingWebhookProcessor` may call
   * (docs/saas/DECISIONS.md P7-D3) — routes an already-normalized,
   * already tenant-resolved, already staleness-checked provider event
   * into one of this file's own EXISTING transition methods. Deliberately
   * NOT a second state machine: every branch below calls a method that
   * already exists for a non-webhook caller — `subscription-state-
   * machine.ts` remains the one and only transition table.
   *
   * Recognizes exactly the confirmation-only event types that need no
   * vendor-specific payload interpretation to apply
   * (`payment_failed` / `recovered` / `cancelled`). An `activated`-style
   * confirmation would additionally need a confirmed billing period
   * (`currentPeriodStart`/`currentPeriodEnd`), which can only be read out
   * of a real vendor's own payload shape — the production billing
   * provider remains OPEN (P7-D1 Part G), so reading period dates out of
   * `event.payload` here would mean inventing a vendor payload schema,
   * explicitly out of scope for this wave. That mapping is deliberately
   * deferred to whenever a real `BillingProvider` adapter is chosen and
   * built — it is not a gap in this method's own logic, and is called out
   * as remaining provider-dependent work.
   *
   * `event.type` is NOT a real vendor's own event-name vocabulary
   * (`invoice.paid`, `subscription.charged`, etc.) — it is whatever a real
   * `BillingProvider.parseWebhook()` implementation normalizes a vendor
   * event into, exactly as `NormalizedBillingEvent`'s own interface doc
   * comment already anticipates ("the caller ... is responsible for
   * interpreting this against whichever provider produced it").
   * `FakeBillingProvider.buildWebhookEventBody()` emits these same
   * canonical type strings directly, since it has no real vendor
   * vocabulary to translate from.
   *
   * Any outcome here (applied, or a safe no-op because the target state
   * already holds, or an unrecognized `event.type`) is a NON-throwing
   * return — `BillingWebhookProcessor` marks the row `PROCESSED` in every
   * one of those cases; only a thrown error (e.g. an illegal transition)
   * signals a retry/dead-letter decision to the caller.
   */
  async applyBillingWebhookEvent(
    client: Client,
    subscription: Subscription,
    event: NormalizedBillingEvent,
  ): Promise<TransitionResult<Subscription>> {
    switch (event.type) {
      case 'payment_failed': {
        const graceEndsAt = new Date(
          Date.now() + GRACE_PERIOD_DAYS * MS_PER_DAY,
        );
        return this.recordPaymentFailure(client, subscription, {
          graceEndsAt,
          providerEventId: event.providerEventId,
        });
      }
      case 'recovered':
        return this.recoverPayment(client, subscription, {
          providerEventId: event.providerEventId,
        });
      case 'cancelled':
        return this.cancel(client, subscription, {
          providerEventId: event.providerEventId,
        });
      default:
        // Unrecognized/not-yet-supported event type — a safe no-op, never
        // an error. Expected and correct during this vendor-undecided
        // phase (P7-D1 Part G, still OPEN), not a processing failure.
        return { applied: false, subscription, eventType: null };
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  /** Same `assertPlanExists`-style check `platform-plans.service.ts`
   * already uses — the application-level substitute for the DB-level FK
   * `pendingPlanId`/`toPlanId` cannot have on the pre-existing
   * `subscriptions` table (see schema.prisma's own comment on
   * `Subscription.pendingPlanId`). */
  /**
   * `confirmUpgrade`/`scheduleDowngrade`/`applyScheduledDowngrade` all
   * operate on an already-`ACTIVE` subscription's OTHER fields
   * (`planId`/`pendingPlanId`) while `status` itself never changes — this
   * is deliberately NOT the same check as
   * `assertSubscriptionTransitionAllowed(status, 'ACTIVE')` (which asks
   * "can this status transition INTO ACTIVE", true for e.g. `PENDING`,
   * and would incorrectly let a `PENDING` subscription be "upgraded"
   * before it has ever been activated at all). This asks the narrower,
   * correct question: "is this subscription CURRENTLY ACTIVE".
   */
  private assertCurrentlyActive(subscription: Subscription): void {
    if (subscription.status !== 'ACTIVE') {
      throw new ConflictException(
        `Subscription must be ACTIVE for this operation (currently ${subscription.status})`,
      );
    }
  }

  private async assertPlanExists(
    client: Client,
    planId: string,
  ): Promise<void> {
    const plan = await client.plan.findUnique({ where: { id: planId } });
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
  }

  /** Never used by any method above (they all take `isSubscriptionTransitionAllowed`
   * only indirectly via the assert helper) — exported re-check kept here
   * so a future caller (e.g. a controller deciding which action buttons
   * to show) can query "is X allowed from here" without duplicating the
   * table import. */
  canTransition(
    from: Subscription['status'],
    to: Subscription['status'],
  ): boolean {
    return isSubscriptionTransitionAllowed(from, to);
  }
}
