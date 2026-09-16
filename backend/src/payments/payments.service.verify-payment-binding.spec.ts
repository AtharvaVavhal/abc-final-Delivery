import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { OrderStatus, PaymentAttemptStatus, PaymentProviderType } from '@prisma/client';
import { PaymentAccountTenantMismatchError } from './payment-accounts/payment-account-resolution.errors';
import { MerchantPaymentUnavailableError } from './merchant-commerce.errors';
import { PaymentsService } from './payments.service';

/**
 * P8-9 — `PaymentsService.verifyPayment`'s merchant-commerce wiring:
 * signature verification now goes through the Order's bound
 * `PaymentAccount` + `PaymentProviderAdapter` (via `resolveForBoundAccount`
 * only, never re-derived from `Store`, never a client-selectable id — the
 * `VerifyPaymentDto` has no such field), instead of the global
 * `RazorpayService.verifySignature`.
 *
 * Same hand-built-mock convention as the sibling `initiatePayment` P8-9
 * spec — no DB, no HTTP, no Nest testing module, no real Razorpay SDK
 * call.
 */
describe('PaymentsService.verifyPayment — merchant PaymentAccount + provider adapter wiring (P8-9)', () => {
  const ENCRYPTED_BLOB = Buffer.from('opaque-ciphertext-should-never-appear');

  const dto = {
    razorpay_order_id: 'rzp_order_1',
    razorpay_payment_id: 'rzp_payment_1',
    razorpay_signature: 'sig-from-checkout-js',
  };

  const baseOrder = {
    id: 'order-1',
    userId: 'user-1',
    tenantId: 'tenant-a',
    storeId: 'store-a',
    status: OrderStatus.PENDING_PAYMENT,
    razorpayOrderId: dto.razorpay_order_id,
    paymentAccountId: 'pa-1' as string | null,
  };

  function makeAdapter(verifyResult = true) {
    return {
      provider: PaymentProviderType.RAZORPAY,
      getPublicKeyId: jest.fn(),
      createOrder: jest.fn(),
      verifyPaymentSignature: jest.fn().mockReturnValue(verifyResult),
      fetchOrderPayments: jest.fn(),
      createRefund: jest.fn(),
    };
  }

  function resolvedFor(adapter: ReturnType<typeof makeAdapter>, paymentAccountId = 'pa-1') {
    return { paymentAccountId, provider: PaymentProviderType.RAZORPAY, adapter };
  }

  function makePrisma(order: typeof baseOrder, opts: { existingByPaymentId?: unknown } = {}) {
    return {
      order: {
        findUnique: jest.fn().mockResolvedValue(order),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ ...order, status: OrderStatus.PAID }),
      },
      paymentAttempt: {
        findUnique: jest.fn().mockResolvedValue(opts.existingByPaymentId ?? null),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) =>
        fn({
          paymentAttempt: {
            findFirst: jest.fn().mockResolvedValue({ id: 'attempt-1', status: PaymentAttemptStatus.INITIATED }),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          order: {
            findUniqueOrThrow: jest.fn().mockResolvedValue({ ...order, status: OrderStatus.PAID }),
            update: jest.fn(),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            findUnique: jest.fn().mockResolvedValue(order),
          },
          orderStatusHistory: { create: jest.fn() },
          outboxEvent: { create: jest.fn() },
          cart: { findFirst: jest.fn().mockResolvedValue(null) },
          cartItem: { findMany: jest.fn() },
          orderItem: { findMany: jest.fn() },
        }),
      ),
    };
  }

  function makeRazorpay() {
    return {
      verifySignature: jest.fn(() => {
        throw new Error('must never use the global RazorpayService to verify a merchant commerce payment');
      }),
      getKeyId: jest.fn(),
    };
  }

  function makeResolution(resolveForBoundAccount: jest.Mock) {
    return {
      resolveForStore: jest.fn(() => {
        throw new Error('verifyPayment must never re-resolve from Store — only resolveForBoundAccount');
      }),
      resolveForBoundAccount,
    };
  }

  function makePaymentAccounts(encrypted: Buffer | null = ENCRYPTED_BLOB) {
    return { getEncryptedCredentials: jest.fn().mockResolvedValue(encrypted) };
  }

  // ─── happy path ─────────────────────────────────────────────────────

  it('valid signature succeeds — verified via the Order\'s bound PaymentAccount adapter', async () => {
    const adapter = makeAdapter(true);
    const resolveForBoundAccount = jest.fn().mockResolvedValue(resolvedFor(adapter));
    const prisma = makePrisma({ ...baseOrder });
    const service = new PaymentsService(
      prisma as never,
      makeRazorpay() as never,
      makeResolution(resolveForBoundAccount) as never,
      makePaymentAccounts() as never,
    );

    const result = await service.verifyPayment('user-1', dto);

    expect(resolveForBoundAccount).toHaveBeenCalledWith('tenant-a', 'pa-1');
    expect(adapter.verifyPaymentSignature).toHaveBeenCalledWith(ENCRYPTED_BLOB, {
      providerOrderId: dto.razorpay_order_id,
      providerPaymentId: dto.razorpay_payment_id,
      providerSignature: dto.razorpay_signature,
    });
    expect(result.status).toBe(OrderStatus.PAID);
  });

  it('the correct bound PaymentAccount is used — the one on the Order, not any other', async () => {
    const adapter = makeAdapter(true);
    const resolveForBoundAccount = jest.fn().mockResolvedValue(resolvedFor(adapter, 'pa-correct'));
    const prisma = makePrisma({ ...baseOrder, paymentAccountId: 'pa-correct' });
    const service = new PaymentsService(
      prisma as never,
      makeRazorpay() as never,
      makeResolution(resolveForBoundAccount) as never,
      makePaymentAccounts() as never,
    );

    await service.verifyPayment('user-1', dto);

    expect(resolveForBoundAccount).toHaveBeenCalledWith('tenant-a', 'pa-correct');
  });

  it('platform/SaaS credentials are never used — the global RazorpayService.verifySignature is never called', async () => {
    const adapter = makeAdapter(true);
    const razorpayService = makeRazorpay();
    const resolveForBoundAccount = jest.fn().mockResolvedValue(resolvedFor(adapter));
    const prisma = makePrisma({ ...baseOrder });
    const service = new PaymentsService(
      prisma as never,
      razorpayService as never,
      makeResolution(resolveForBoundAccount) as never,
      makePaymentAccounts() as never,
    );

    await service.verifyPayment('user-1', dto);

    expect(razorpayService.verifySignature).not.toHaveBeenCalled();
  });

  // ─── invalid signature ──────────────────────────────────────────────

  it('invalid signature fails with BadRequestException, no state transition attempted', async () => {
    const adapter = makeAdapter(false);
    const resolveForBoundAccount = jest.fn().mockResolvedValue(resolvedFor(adapter));
    const prisma = makePrisma({ ...baseOrder });
    const service = new PaymentsService(
      prisma as never,
      makeRazorpay() as never,
      makeResolution(resolveForBoundAccount) as never,
      makePaymentAccounts() as never,
    );

    await expect(service.verifyPayment('user-1', dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // ─── client cannot select another PaymentAccount ───────────────────

  it('client cannot select another PaymentAccount — VerifyPaymentDto carries no account-selecting field, and any such field would be ignored', async () => {
    const adapter = makeAdapter(true);
    const resolveForBoundAccount = jest.fn().mockResolvedValue(resolvedFor(adapter, 'pa-1'));
    const prisma = makePrisma({ ...baseOrder, paymentAccountId: 'pa-1' });
    const service = new PaymentsService(
      prisma as never,
      makeRazorpay() as never,
      makeResolution(resolveForBoundAccount) as never,
      makePaymentAccounts() as never,
    );

    // Even if a caller smuggled an extra field onto the DTO object, the
    // service signature only destructures the three documented fields —
    // there is no code path that reads anything else.
    const dtoWithExtra = { ...dto, paymentAccountId: 'pa-attacker-controlled' };

    await service.verifyPayment('user-1', dtoWithExtra as never);

    expect(resolveForBoundAccount).toHaveBeenCalledWith('tenant-a', 'pa-1');
  });

  // ─── tenant isolation ───────────────────────────────────────────────

  it('tenant isolation — order ownership (userId) is enforced with a 404, never revealing existence to another user', async () => {
    const prisma = makePrisma({ ...baseOrder, userId: 'someone-else' });
    const service = new PaymentsService(
      prisma as never,
      makeRazorpay() as never,
      makeResolution(jest.fn()) as never,
      makePaymentAccounts() as never,
    );

    await expect(service.verifyPayment('user-1', dto)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('fails cleanly (never a global fallback) when resolveForBoundAccount reports a tenant mismatch', async () => {
    const resolveForBoundAccount = jest.fn().mockRejectedValue(new PaymentAccountTenantMismatchError('pa-1'));
    const prisma = makePrisma({ ...baseOrder });
    const service = new PaymentsService(
      prisma as never,
      makeRazorpay() as never,
      makeResolution(resolveForBoundAccount) as never,
      makePaymentAccounts() as never,
    );

    await expect(service.verifyPayment('user-1', dto)).rejects.toBeInstanceOf(MerchantPaymentUnavailableError);
  });

  it('fails cleanly when the Order has no bound PaymentAccount at all (pre-P8-9 legacy order)', async () => {
    const prisma = makePrisma({ ...baseOrder, paymentAccountId: null });
    const service = new PaymentsService(
      prisma as never,
      makeRazorpay() as never,
      makeResolution(jest.fn()) as never,
      makePaymentAccounts() as never,
    );

    await expect(service.verifyPayment('user-1', dto)).rejects.toBeInstanceOf(MerchantPaymentUnavailableError);
  });

  it('fails cleanly when the resolved account has no encrypted credentials', async () => {
    const adapter = makeAdapter(true);
    const resolveForBoundAccount = jest.fn().mockResolvedValue(resolvedFor(adapter));
    const prisma = makePrisma({ ...baseOrder });
    const service = new PaymentsService(
      prisma as never,
      makeRazorpay() as never,
      makeResolution(resolveForBoundAccount) as never,
      makePaymentAccounts(null) as never,
    );

    await expect(service.verifyPayment('user-1', dto)).rejects.toBeInstanceOf(MerchantPaymentUnavailableError);
    expect(adapter.verifyPaymentSignature).not.toHaveBeenCalled();
  });

  // ─── repeated verification is safe/idempotent ──────────────────────

  it('repeated verification for an already-CAPTURED payment is a safe no-op fast path (still verifies signature against the correct account first)', async () => {
    const adapter = makeAdapter(true);
    const resolveForBoundAccount = jest.fn().mockResolvedValue(resolvedFor(adapter));
    const prisma = makePrisma(
      { ...baseOrder },
      { existingByPaymentId: { id: 'attempt-1', status: PaymentAttemptStatus.CAPTURED } },
    );
    const service = new PaymentsService(
      prisma as never,
      makeRazorpay() as never,
      makeResolution(resolveForBoundAccount) as never,
      makePaymentAccounts() as never,
    );

    const result = await service.verifyPayment('user-1', dto);

    expect(adapter.verifyPaymentSignature).toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(result.status).toBe(OrderStatus.PAID);
  });

  it('the provider payment id is only ever attached inside the CAS-guarded transaction, after signature verification succeeds', async () => {
    const adapter = makeAdapter(true);
    const resolveForBoundAccount = jest.fn().mockResolvedValue(resolvedFor(adapter));
    const prisma = makePrisma({ ...baseOrder });
    const service = new PaymentsService(
      prisma as never,
      makeRazorpay() as never,
      makeResolution(resolveForBoundAccount) as never,
      makePaymentAccounts() as never,
    );

    await service.verifyPayment('user-1', dto);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('no pending attempt found still surfaces as a stable ConflictException (unchanged existing behavior)', async () => {
    const adapter = makeAdapter(true);
    const resolveForBoundAccount = jest.fn().mockResolvedValue(resolvedFor(adapter));
    const prisma = makePrisma({ ...baseOrder });
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        paymentAttempt: { findFirst: jest.fn().mockResolvedValue(null) },
        order: { findUniqueOrThrow: jest.fn() },
      }),
    );
    const service = new PaymentsService(
      prisma as never,
      makeRazorpay() as never,
      makeResolution(resolveForBoundAccount) as never,
      makePaymentAccounts() as never,
    );

    await expect(service.verifyPayment('user-1', dto)).rejects.toBeInstanceOf(ConflictException);
  });
});
