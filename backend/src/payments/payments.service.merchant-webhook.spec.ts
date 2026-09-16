import { BadRequestException } from '@nestjs/common';
import {
  OrderStatus,
  PaymentAttemptStatus,
  PaymentProviderType,
  Prisma,
  RefundStatus,
} from '@prisma/client';
import {
  UnknownPaymentAccountError,
  PaymentAccountTenantMismatchError,
} from './payment-accounts/payment-account-resolution.errors';
import { PaymentMismatchError } from './payment-mismatch.error';
import {
  PaymentsService,
  UnresolvedRefundWebhookError,
} from './payments.service';

/**
 * P8-10 — merchant commerce webhook routing (`receiveMerchantWebhook`,
 * Phase 1: verify + persist) and processing (`applyMerchantWebhookEvent`,
 * Phase 2: reconcile PaymentAttempt/Order). Same hand-built-mock
 * convention as the sibling P8-9 specs — no DB, no HTTP, no Nest testing
 * module, no real Razorpay SDK call anywhere.
 */
describe('PaymentsService — merchant commerce webhooks (P8-10)', () => {
  const ENCRYPTED_BLOB = Buffer.from('opaque-ciphertext-should-never-appear');
  const RAW_BODY =
    '{"event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_1","order_id":"rzp_o1","amount":15000,"currency":"INR","status":"captured"}}}}';

  function makeAdapter(verifyResult = true) {
    return {
      provider: PaymentProviderType.RAZORPAY,
      getPublicKeyId: jest.fn(),
      createOrder: jest.fn(),
      verifyPaymentSignature: jest.fn(),
      verifyWebhookSignature: jest.fn().mockReturnValue(verifyResult),
      fetchOrderPayments: jest.fn(),
      createRefund: jest.fn(),
    };
  }

  function resolvedWebhookAccount(
    adapter: ReturnType<typeof makeAdapter>,
    overrides: { paymentAccountId?: string; tenantId?: string } = {},
  ) {
    return {
      paymentAccountId: overrides.paymentAccountId ?? 'pa-1',
      tenantId: overrides.tenantId ?? 'tenant-a',
      provider: PaymentProviderType.RAZORPAY,
      adapter,
    };
  }

  function makeRazorpay() {
    return {
      verifyWebhookSignature: jest.fn(() => {
        throw new Error(
          'must never use the global RazorpayService for a merchant commerce webhook',
        );
      }),
    };
  }

  function makeResolution(opts: {
    resolveForWebhook?: jest.Mock;
    resolveForBoundAccount?: jest.Mock;
  }) {
    return {
      resolveForStore: jest.fn(() => {
        throw new Error(
          'merchant webhook processing must never re-resolve from Store',
        );
      }),
      resolveForBoundAccount: opts.resolveForBoundAccount ?? jest.fn(),
      resolveForWebhook: opts.resolveForWebhook ?? jest.fn(),
    };
  }

  function makePaymentAccounts(encrypted: Buffer | null = ENCRYPTED_BLOB) {
    return { getEncryptedCredentials: jest.fn().mockResolvedValue(encrypted) };
  }

  // ══════════════════════ receiveMerchantWebhook (Phase 1) ══════════════

  describe('receiveMerchantWebhook — routing, signature, persistence', () => {
    function makePrismaForReceive() {
      return { $queryRaw: jest.fn().mockResolvedValue(undefined) };
    }

    it('resolves the correct PaymentAccount from the path identifier before verifying', async () => {
      const adapter = makeAdapter(true);
      const resolveForWebhook = jest
        .fn()
        .mockResolvedValue(resolvedWebhookAccount(adapter));
      const prisma = makePrismaForReceive();
      const service = new PaymentsService(
        prisma as never,
        makeRazorpay() as never,
        makeResolution({ resolveForWebhook }) as never,
        makePaymentAccounts() as never,
      );

      await service.receiveMerchantWebhook('pa-1', RAW_BODY, 'sig', 'evt-1');

      expect(resolveForWebhook).toHaveBeenCalledWith('pa-1');
    });

    it('valid signature is accepted and the event is persisted via the existing WebhookEvent INSERT ... ON CONFLICT mechanism', async () => {
      const adapter = makeAdapter(true);
      const resolveForWebhook = jest
        .fn()
        .mockResolvedValue(resolvedWebhookAccount(adapter));
      const prisma = makePrismaForReceive();
      const service = new PaymentsService(
        prisma as never,
        makeRazorpay() as never,
        makeResolution({ resolveForWebhook }) as never,
        makePaymentAccounts() as never,
      );

      await service.receiveMerchantWebhook('pa-1', RAW_BODY, 'sig', 'evt-1');

      expect(adapter.verifyWebhookSignature).toHaveBeenCalledWith(
        ENCRYPTED_BLOB,
        RAW_BODY,
        'sig',
      );
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('an unknown account id is rejected with the SAME generic message as a bad signature — no existence oracle', async () => {
      const resolveForWebhook = jest
        .fn()
        .mockRejectedValue(new UnknownPaymentAccountError('nope'));
      const prisma = makePrismaForReceive();
      const service = new PaymentsService(
        prisma as never,
        makeRazorpay() as never,
        makeResolution({ resolveForWebhook }) as never,
        makePaymentAccounts() as never,
      );

      const err = await service
        .receiveMerchantWebhook('nope', RAW_BODY, 'sig', 'evt-1')
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).message).toBe(
        'Invalid webhook signature',
      );
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('an account with no credentials configured is rejected the same way, no DB write', async () => {
      const adapter = makeAdapter(true);
      const resolveForWebhook = jest
        .fn()
        .mockResolvedValue(resolvedWebhookAccount(adapter));
      const prisma = makePrismaForReceive();
      const service = new PaymentsService(
        prisma as never,
        makeRazorpay() as never,
        makeResolution({ resolveForWebhook }) as never,
        makePaymentAccounts(null) as never,
      );

      await expect(
        service.receiveMerchantWebhook('pa-1', RAW_BODY, 'sig', 'evt-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(adapter.verifyWebhookSignature).not.toHaveBeenCalled();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('an invalid signature is rejected — no DB write at all', async () => {
      const adapter = makeAdapter(false);
      const resolveForWebhook = jest
        .fn()
        .mockResolvedValue(resolvedWebhookAccount(adapter));
      const prisma = makePrismaForReceive();
      const service = new PaymentsService(
        prisma as never,
        makeRazorpay() as never,
        makeResolution({ resolveForWebhook }) as never,
        makePaymentAccounts() as never,
      );

      const err = await service
        .receiveMerchantWebhook('pa-1', RAW_BODY, 'wrong-sig', 'evt-1')
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it("a signature valid for a DIFFERENT account is rejected — verification is scoped to exactly the resolved account's own secret", async () => {
      // Simulates "wrong account signature": the adapter for account pa-1
      // is asked to verify a signature that was actually produced with
      // pa-2's secret — from pa-1's own adapter's perspective that is
      // simply an invalid signature.
      const adapterForPa1 = makeAdapter(false);
      const resolveForWebhook = jest
        .fn()
        .mockResolvedValue(
          resolvedWebhookAccount(adapterForPa1, { paymentAccountId: 'pa-1' }),
        );
      const prisma = makePrismaForReceive();
      const service = new PaymentsService(
        prisma as never,
        makeRazorpay() as never,
        makeResolution({ resolveForWebhook }) as never,
        makePaymentAccounts() as never,
      );

      await expect(
        service.receiveMerchantWebhook(
          'pa-1',
          RAW_BODY,
          'sig-from-pa-2',
          'evt-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('platform/SaaS credentials are never used — the global RazorpayService.verifyWebhookSignature is never called', async () => {
      const adapter = makeAdapter(true);
      const razorpayService = makeRazorpay();
      const resolveForWebhook = jest
        .fn()
        .mockResolvedValue(resolvedWebhookAccount(adapter));
      const prisma = makePrismaForReceive();
      const service = new PaymentsService(
        prisma as never,
        razorpayService as never,
        makeResolution({ resolveForWebhook }) as never,
        makePaymentAccounts() as never,
      );

      await service.receiveMerchantWebhook('pa-1', RAW_BODY, 'sig', 'evt-1');

      expect(razorpayService.verifyWebhookSignature).not.toHaveBeenCalled();
    });

    it('no credential leakage — a resolution/verification failure never includes credential material in the thrown error', async () => {
      const resolveForWebhook = jest
        .fn()
        .mockRejectedValue(new UnknownPaymentAccountError('pa-x'));
      const prisma = makePrismaForReceive();
      const service = new PaymentsService(
        prisma as never,
        makeRazorpay() as never,
        makeResolution({ resolveForWebhook }) as never,
        makePaymentAccounts() as never,
      );

      const err = await service
        .receiveMerchantWebhook('pa-x', RAW_BODY, 'sig', 'evt-1')
        .catch((e: unknown) => e);

      expect((err as Error).message).not.toContain('opaque-ciphertext');
      expect((err as Error).message).not.toMatch(/pa-x/);
    });

    it('malformed JSON payload (post-signature-check) is rejected cleanly', async () => {
      const adapter = makeAdapter(true);
      const resolveForWebhook = jest
        .fn()
        .mockResolvedValue(resolvedWebhookAccount(adapter));
      const prisma = makePrismaForReceive();
      const service = new PaymentsService(
        prisma as never,
        makeRazorpay() as never,
        makeResolution({ resolveForWebhook }) as never,
        makePaymentAccounts() as never,
      );

      await expect(
        service.receiveMerchantWebhook('pa-1', 'not-json', 'sig', 'evt-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ══════════════════ applyMerchantWebhookEvent (Phase 2) ═══════════════

  describe('applyMerchantWebhookEvent — reconciliation, isolation, state safety', () => {
    const CAPTURED_PAYLOAD = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_1',
            order_id: 'rzp_o1',
            amount: 14900,
            currency: 'INR',
            status: 'captured',
            method: 'upi',
          },
        },
      },
    };
    const FAILED_PAYLOAD = {
      event: 'payment.failed',
      payload: {
        payment: {
          entity: {
            id: 'pay_1',
            order_id: 'rzp_o1',
            amount: 14900,
            currency: 'INR',
            status: 'failed',
            error_code: 'BAD_REQUEST_ERROR',
            error_description: 'card declined',
          },
        },
      },
    };

    const boundOrder = {
      id: 'order-1',
      tenantId: 'tenant-a',
      orderNumber: 'PF-000001',
      status: OrderStatus.PENDING_PAYMENT,
      razorpayOrderId: 'rzp_o1',
      currency: 'INR',
      total: new Prisma.Decimal('149.00'),
      paymentAccountId: 'pa-1',
      userId: 'user-1',
    };

    function makeTx(opts: {
      order?: Record<string, unknown> | null;
      existingAttempt?: Record<string, unknown> | null;
    }) {
      const attempts = new Map<string, Record<string, unknown>>();
      if (opts.existingAttempt) {
        attempts.set(opts.existingAttempt.id as string, {
          ...opts.existingAttempt,
        });
      }
      return {
        order: {
          findUnique: jest.fn().mockResolvedValue(opts.order ?? null),
          updateMany: jest.fn().mockImplementation(({ where, data }) => {
            const ord = opts.order;
            if (ord && ord.status === where.status) {
              opts.order = { ...ord, status: data.status };
              return Promise.resolve({ count: 1 });
            }
            return Promise.resolve({ count: 0 });
          }),
        },
        paymentAttempt: {
          findUnique: jest.fn().mockImplementation(({ where }) => {
            if (where.razorpayPaymentId) {
              for (const a of attempts.values()) {
                if (a.razorpayPaymentId === where.razorpayPaymentId)
                  return Promise.resolve(a);
              }
            }
            return Promise.resolve(null);
          }),
          findFirst: jest.fn().mockImplementation(({ where }) => {
            for (const a of attempts.values()) {
              if (a.orderId === where.orderId && a.status === where.status) {
                return Promise.resolve(a);
              }
            }
            return Promise.resolve(null);
          }),
          create: jest.fn().mockImplementation(({ data }) => {
            const row = { id: `attempt-${attempts.size + 1}`, ...data };
            attempts.set(row.id, row);
            return Promise.resolve(row);
          }),
          update: jest.fn().mockImplementation(({ where, data }) => {
            const row = { ...attempts.get(where.id), ...data };
            attempts.set(where.id, row);
            return Promise.resolve(row);
          }),
          updateMany: jest.fn().mockImplementation(({ where, data }) => {
            const row = attempts.get(where.id);
            if (!row) return Promise.resolve({ count: 0 });
            const statusOk = where.status?.not
              ? row.status !== where.status.not
              : where.status?.notIn
                ? !where.status.notIn.includes(row.status)
                : true;
            if (!statusOk) return Promise.resolve({ count: 0 });
            attempts.set(where.id, { ...row, ...data });
            return Promise.resolve({ count: 1 });
          }),
        },
        orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
        outboxEvent: { create: jest.fn().mockResolvedValue({}) },
        cart: { findFirst: jest.fn().mockResolvedValue(null) },
        cartItem: { findMany: jest.fn() },
        orderItem: { findMany: jest.fn() },
        attempts,
      };
    }

    it('payment captured: PaymentAttempt -> CAPTURED and Order -> PAID', async () => {
      const tx = makeTx({ order: { ...boundOrder } });
      const resolveForBoundAccount = jest.fn().mockResolvedValue({
        paymentAccountId: 'pa-1',
        provider: PaymentProviderType.RAZORPAY,
        adapter: makeAdapter(),
      });
      const service = new PaymentsService(
        {} as never,
        makeRazorpay() as never,
        makeResolution({ resolveForBoundAccount }) as never,
        makePaymentAccounts() as never,
      );

      const outcome = await service.applyMerchantWebhookEvent(
        tx as never,
        'pa-1',
        CAPTURED_PAYLOAD,
      );

      expect(outcome).toBe('PROCESSED');
      expect(tx.order.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: OrderStatus.PAID } }),
      );
      const attempt = [...tx.attempts.values()][0];
      expect(attempt.status).toBe(PaymentAttemptStatus.CAPTURED);
      expect(attempt.paymentAccountId).toBe('pa-1');
    });

    it('payment failed: PaymentAttempt -> FAILED and Order -> PAYMENT_FAILED', async () => {
      const tx = makeTx({ order: { ...boundOrder } });
      const resolveForBoundAccount = jest.fn().mockResolvedValue({
        paymentAccountId: 'pa-1',
        provider: PaymentProviderType.RAZORPAY,
        adapter: makeAdapter(),
      });
      const service = new PaymentsService(
        {} as never,
        makeRazorpay() as never,
        makeResolution({ resolveForBoundAccount }) as never,
        makePaymentAccounts() as never,
      );

      const outcome = await service.applyMerchantWebhookEvent(
        tx as never,
        'pa-1',
        FAILED_PAYLOAD,
      );

      expect(outcome).toBe('PROCESSED');
      expect(tx.order.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: OrderStatus.PAYMENT_FAILED },
        }),
      );
      const attempt = [...tx.attempts.values()][0];
      expect(attempt.status).toBe(PaymentAttemptStatus.FAILED);
    });

    it('unknown order (razorpayOrderId not found) is IGNORED — no attempt/order touched', async () => {
      const tx = makeTx({ order: null });
      const service = new PaymentsService(
        {} as never,
        makeRazorpay() as never,
        makeResolution({}) as never,
        makePaymentAccounts() as never,
      );

      const outcome = await service.applyMerchantWebhookEvent(
        tx as never,
        'pa-1',
        CAPTURED_PAYLOAD,
      );

      expect(outcome).toBe('IGNORED');
      expect(tx.order.updateMany).not.toHaveBeenCalled();
    });

    it('SECURITY: a webhook verified for PaymentAccount A cannot modify an Order bound to PaymentAccount B — IGNORED, order/attempt untouched', async () => {
      const orderBoundToB = {
        ...boundOrder,
        paymentAccountId: 'pa-B',
        tenantId: 'tenant-b',
      };
      const tx = makeTx({ order: orderBoundToB });
      const resolveForBoundAccount = jest.fn();
      const service = new PaymentsService(
        {} as never,
        makeRazorpay() as never,
        makeResolution({ resolveForBoundAccount }) as never,
        makePaymentAccounts() as never,
      );

      const outcome = await service.applyMerchantWebhookEvent(
        tx as never,
        'pa-A',
        CAPTURED_PAYLOAD,
      );

      expect(outcome).toBe('IGNORED');
      expect(tx.order.updateMany).not.toHaveBeenCalled();
      expect(tx.paymentAttempt.create).not.toHaveBeenCalled();
      // Never even attempts to resolve pa-A against this order's tenant —
      // the mismatch is caught by the identity check itself.
      expect(resolveForBoundAccount).not.toHaveBeenCalled();
    });

    it('SECURITY: a webhook for an order with NO bound PaymentAccount is IGNORED — never silently adopted/re-bound', async () => {
      const unboundOrder = { ...boundOrder, paymentAccountId: null };
      const tx = makeTx({ order: unboundOrder });
      const service = new PaymentsService(
        {} as never,
        makeRazorpay() as never,
        makeResolution({}) as never,
        makePaymentAccounts() as never,
      );

      const outcome = await service.applyMerchantWebhookEvent(
        tx as never,
        'pa-1',
        CAPTURED_PAYLOAD,
      );

      expect(outcome).toBe('IGNORED');
      expect(tx.order.updateMany).not.toHaveBeenCalled();
    });

    it('webhook after the account is disabled still processes normally — disabling blocks NEW payments, not history (resolveForBoundAccount does not gate on status)', async () => {
      const tx = makeTx({ order: { ...boundOrder } });
      // Simulates a DISABLED-but-still-resolvable account (resolveForBoundAccount
      // itself never checks status — see that method's own doc comment).
      const resolveForBoundAccount = jest.fn().mockResolvedValue({
        paymentAccountId: 'pa-1',
        provider: PaymentProviderType.RAZORPAY,
        adapter: makeAdapter(),
      });
      const service = new PaymentsService(
        {} as never,
        makeRazorpay() as never,
        makeResolution({ resolveForBoundAccount }) as never,
        makePaymentAccounts() as never,
      );

      const outcome = await service.applyMerchantWebhookEvent(
        tx as never,
        'pa-1',
        CAPTURED_PAYLOAD,
      );

      expect(outcome).toBe('PROCESSED');
    });

    it('a structurally-unexpected resolution failure is IGNORED, not a crash', async () => {
      const tx = makeTx({ order: { ...boundOrder } });
      const resolveForBoundAccount = jest
        .fn()
        .mockRejectedValue(new PaymentAccountTenantMismatchError('pa-1'));
      const service = new PaymentsService(
        {} as never,
        makeRazorpay() as never,
        makeResolution({ resolveForBoundAccount }) as never,
        makePaymentAccounts() as never,
      );

      const outcome = await service.applyMerchantWebhookEvent(
        tx as never,
        'pa-1',
        CAPTURED_PAYLOAD,
      );

      expect(outcome).toBe('IGNORED');
    });

    it('already-CAPTURED (duplicate delivery) is a safe no-op — never re-transitions the order', async () => {
      const alreadyCapturedOrder = { ...boundOrder, status: OrderStatus.PAID };
      const tx = makeTx({
        order: alreadyCapturedOrder,
        existingAttempt: {
          id: 'attempt-1',
          orderId: 'order-1',
          razorpayOrderId: 'rzp_o1',
          razorpayPaymentId: 'pay_1',
          status: PaymentAttemptStatus.CAPTURED,
          paymentAccountId: 'pa-1',
        },
      });
      const resolveForBoundAccount = jest.fn().mockResolvedValue({
        paymentAccountId: 'pa-1',
        provider: PaymentProviderType.RAZORPAY,
        adapter: makeAdapter(),
      });
      const service = new PaymentsService(
        {} as never,
        makeRazorpay() as never,
        makeResolution({ resolveForBoundAccount }) as never,
        makePaymentAccounts() as never,
      );

      const outcome = await service.applyMerchantWebhookEvent(
        tx as never,
        'pa-1',
        CAPTURED_PAYLOAD,
      );

      expect(outcome).toBe('PROCESSED'); // acknowledged safely — no error
      expect(tx.order.updateMany).not.toHaveBeenCalled();
    });

    it('out-of-order events — a FAILED arriving after CAPTURED never moves state backwards', async () => {
      const paidOrder = { ...boundOrder, status: OrderStatus.PAID };
      const tx = makeTx({
        order: paidOrder,
        existingAttempt: {
          id: 'attempt-1',
          orderId: 'order-1',
          razorpayOrderId: 'rzp_o1',
          razorpayPaymentId: 'pay_1',
          status: PaymentAttemptStatus.CAPTURED,
          paymentAccountId: 'pa-1',
        },
      });
      const resolveForBoundAccount = jest.fn().mockResolvedValue({
        paymentAccountId: 'pa-1',
        provider: PaymentProviderType.RAZORPAY,
        adapter: makeAdapter(),
      });
      const service = new PaymentsService(
        {} as never,
        makeRazorpay() as never,
        makeResolution({ resolveForBoundAccount }) as never,
        makePaymentAccounts() as never,
      );

      const outcome = await service.applyMerchantWebhookEvent(
        tx as never,
        'pa-1',
        FAILED_PAYLOAD,
      );

      expect(outcome).toBe('PROCESSED'); // acknowledged, but a no-op
      expect(tx.order.updateMany).not.toHaveBeenCalled();
      const attempt = [...tx.attempts.values()][0];
      expect(attempt.status).toBe(PaymentAttemptStatus.CAPTURED); // never downgraded to FAILED
    });

    it('concurrent/duplicate delivery of the same captured event is idempotent — processing it twice yields the same terminal state, no double transition', async () => {
      const tx = makeTx({ order: { ...boundOrder } });
      const resolveForBoundAccount = jest.fn().mockResolvedValue({
        paymentAccountId: 'pa-1',
        provider: PaymentProviderType.RAZORPAY,
        adapter: makeAdapter(),
      });
      const service = new PaymentsService(
        {} as never,
        makeRazorpay() as never,
        makeResolution({ resolveForBoundAccount }) as never,
        makePaymentAccounts() as never,
      );

      const first = await service.applyMerchantWebhookEvent(
        tx as never,
        'pa-1',
        CAPTURED_PAYLOAD,
      );
      const second = await service.applyMerchantWebhookEvent(
        tx as never,
        'pa-1',
        CAPTURED_PAYLOAD,
      );

      expect(first).toBe('PROCESSED');
      expect(second).toBe('PROCESSED');
      expect(tx.order.updateMany).toHaveBeenCalledTimes(1); // transitioned exactly once
    });

    it('fetchOrderPayments/verifyWebhookSignature are never called during PaymentAttempt/Order reconciliation — capture/fail trust the already-verified payload, exactly like the pre-P8-10 global path', async () => {
      const tx = makeTx({ order: { ...boundOrder } });
      const adapter = makeAdapter();
      const resolveForBoundAccount = jest.fn().mockResolvedValue({
        paymentAccountId: 'pa-1',
        provider: PaymentProviderType.RAZORPAY,
        adapter,
      });
      const service = new PaymentsService(
        {} as never,
        makeRazorpay() as never,
        makeResolution({ resolveForBoundAccount }) as never,
        makePaymentAccounts() as never,
      );

      await service.applyMerchantWebhookEvent(
        tx as never,
        'pa-1',
        CAPTURED_PAYLOAD,
      );

      expect(adapter.fetchOrderPayments).not.toHaveBeenCalled();
      expect(adapter.verifyWebhookSignature).not.toHaveBeenCalled();
    });
  });

  // ═════════════ applyMerchantWebhookEvent — refund completion (P8-11) ═══

  describe('applyMerchantWebhookEvent — refund webhook completion', () => {
    const REFUND_PROCESSED_PAYLOAD = {
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: 'rfnd_1',
            payment_id: 'pay_1',
            amount: 5000,
            status: 'processed',
          },
        },
      },
    };
    const REFUND_FAILED_PAYLOAD = {
      event: 'refund.failed',
      payload: {
        refund: {
          entity: {
            id: 'rfnd_1',
            payment_id: 'pay_1',
            amount: 5000,
            status: 'failed',
            error_description: 'insufficient balance',
          },
        },
      },
    };

    function makeRefundTx(refund: Record<string, unknown> | null) {
      const row = refund ? { ...refund } : null;
      return {
        refund: {
          findUnique: jest.fn().mockResolvedValue(row),
          updateMany: jest.fn().mockImplementation(({ where, data }) => {
            if (!row || row.id !== where.id || row.status !== where.status) {
              return Promise.resolve({ count: 0 });
            }
            Object.assign(row, data);
            return Promise.resolve({ count: 1 });
          }),
        },
        row,
      };
    }

    function makePaymentsServiceForRefundWebhook() {
      return new PaymentsService(
        {} as never,
        makeRazorpay() as never,
        makeResolution({}) as never,
        makePaymentAccounts() as never,
      );
    }

    it('refund.processed settles a PENDING Refund row to PROCESSED', async () => {
      const tx = makeRefundTx({
        id: 'refund-1',
        razorpayRefundId: 'rfnd_1',
        amountPaise: 5000n,
        status: RefundStatus.PENDING,
        paymentAccountId: 'pa-1',
      });
      const service = makePaymentsServiceForRefundWebhook();

      const outcome = await service.applyMerchantWebhookEvent(
        tx as never,
        'pa-1',
        REFUND_PROCESSED_PAYLOAD,
      );

      expect(outcome).toBe('PROCESSED');
      expect(tx.row!.status).toBe(RefundStatus.PROCESSED);
    });

    it('refund.failed settles a PENDING Refund row to FAILED with a failureReason', async () => {
      const tx = makeRefundTx({
        id: 'refund-1',
        razorpayRefundId: 'rfnd_1',
        amountPaise: 5000n,
        status: RefundStatus.PENDING,
        paymentAccountId: 'pa-1',
      });
      const service = makePaymentsServiceForRefundWebhook();

      const outcome = await service.applyMerchantWebhookEvent(
        tx as never,
        'pa-1',
        REFUND_FAILED_PAYLOAD,
      );

      expect(outcome).toBe('PROCESSED');
      expect(tx.row!.status).toBe(RefundStatus.FAILED);
      expect(tx.row!.failureReason).toBe('insufficient balance');
    });

    it('P8-13 (P1 #2 fix): an unknown razorpayRefundId THROWS UnresolvedRefundWebhookError — retryable, never permanently IGNORED', async () => {
      // Superseded assertion (pre-P8-13): this case used to return
      // 'IGNORED', which WebhookProcessor treats as a permanent, non-
      // retried terminal state — exactly the P1 #2 finding
      // (docs/saas/PHASE-8-SECURITY-AUDIT.md §9/§18): a refund whose
      // completion webhook wins the race against RefundsService's own
      // razorpayRefundId stamp would be lost forever. It must now THROW,
      // so WebhookProcessor's existing bounded-backoff retry gets a
      // chance to find the row once the local write has caught up (see
      // the dedicated race-regression spec for the full race-then-retry
      // proof).
      const tx = makeRefundTx(null);
      const service = makePaymentsServiceForRefundWebhook();

      await expect(
        service.applyMerchantWebhookEvent(
          tx as never,
          'pa-1',
          REFUND_PROCESSED_PAYLOAD,
        ),
      ).rejects.toBeInstanceOf(UnresolvedRefundWebhookError);
    });

    it('SECURITY: a refund webhook verified for PaymentAccount A cannot settle a Refund bound to PaymentAccount B', async () => {
      const tx = makeRefundTx({
        id: 'refund-1',
        razorpayRefundId: 'rfnd_1',
        amountPaise: 5000n,
        status: RefundStatus.PENDING,
        paymentAccountId: 'pa-B',
      });
      const service = makePaymentsServiceForRefundWebhook();

      const outcome = await service.applyMerchantWebhookEvent(
        tx as never,
        'pa-A',
        REFUND_PROCESSED_PAYLOAD,
      );

      expect(outcome).toBe('IGNORED');
      expect(tx.row!.status).toBe(RefundStatus.PENDING); // untouched
    });

    it('an amount mismatch throws PaymentMismatchError (non-retryable dead-letter, same as a payment-capture mismatch) — never silently settles', async () => {
      const tx = makeRefundTx({
        id: 'refund-1',
        razorpayRefundId: 'rfnd_1',
        amountPaise: 9999n, // does not match the payload's 5000
        status: RefundStatus.PENDING,
        paymentAccountId: 'pa-1',
      });
      const service = makePaymentsServiceForRefundWebhook();

      await expect(
        service.applyMerchantWebhookEvent(
          tx as never,
          'pa-1',
          REFUND_PROCESSED_PAYLOAD,
        ),
      ).rejects.toBeInstanceOf(PaymentMismatchError);
      expect(tx.row!.status).toBe(RefundStatus.PENDING); // untouched
    });

    it('an already-PROCESSED refund is a safe no-op on repeated delivery (CAS-guarded, never double-applied)', async () => {
      const tx = makeRefundTx({
        id: 'refund-1',
        razorpayRefundId: 'rfnd_1',
        amountPaise: 5000n,
        status: RefundStatus.PROCESSED,
        paymentAccountId: 'pa-1',
      });
      const service = makePaymentsServiceForRefundWebhook();

      const outcome = await service.applyMerchantWebhookEvent(
        tx as never,
        'pa-1',
        REFUND_PROCESSED_PAYLOAD,
      );

      expect(outcome).toBe('PROCESSED'); // acknowledged
      expect(tx.refund.updateMany).toHaveBeenCalled();
      expect(tx.row!.status).toBe(RefundStatus.PROCESSED); // unchanged, not re-applied
    });
  });
});
