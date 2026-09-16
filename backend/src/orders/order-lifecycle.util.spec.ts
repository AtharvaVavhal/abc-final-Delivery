import { ConflictException } from '@nestjs/common';
import { OrderStatus, PaymentAttemptStatus } from '@prisma/client';
import {
  assertTransitionAllowed,
  isOrderCancellable,
  orderNeedsRefund,
} from './order-lifecycle.util';

describe('isOrderCancellable', () => {
  it('is cancellable from PAID', () => {
    expect(isOrderCancellable(OrderStatus.PAID)).toBe(true);
  });

  it('is cancellable from CONFIRMED', () => {
    expect(isOrderCancellable(OrderStatus.CONFIRMED)).toBe(true);
  });

  it('is cancellable from PENDING_PAYMENT (abandon unpaid checkout)', () => {
    expect(isOrderCancellable(OrderStatus.PENDING_PAYMENT)).toBe(true);
  });

  it('is cancellable from PAYMENT_FAILED (abandon unpaid checkout)', () => {
    expect(isOrderCancellable(OrderStatus.PAYMENT_FAILED)).toBe(true);
  });

  it('is NOT cancellable once IN_PRODUCTION', () => {
    expect(isOrderCancellable(OrderStatus.IN_PRODUCTION)).toBe(false);
  });

  it('is NOT cancellable once SHIPPED', () => {
    expect(isOrderCancellable(OrderStatus.SHIPPED)).toBe(false);
  });

  it('is NOT cancellable once DELIVERED', () => {
    expect(isOrderCancellable(OrderStatus.DELIVERED)).toBe(false);
  });

  it('is NOT cancellable from an already-CANCELLED order', () => {
    expect(isOrderCancellable(OrderStatus.CANCELLED)).toBe(false);
  });

  it('is NOT cancellable from REFUNDED (terminal)', () => {
    expect(isOrderCancellable(OrderStatus.REFUNDED)).toBe(false);
  });
});

describe('orderNeedsRefund', () => {
  it('needs a refund when a CAPTURED payment attempt exists', () => {
    expect(orderNeedsRefund({ status: PaymentAttemptStatus.CAPTURED })).toBe(
      true,
    );
  });

  it('does not need a refund when no payment attempt was captured (null)', () => {
    expect(orderNeedsRefund(null)).toBe(false);
  });

  it('does not need a refund for an INITIATED (not yet captured) attempt', () => {
    expect(orderNeedsRefund({ status: PaymentAttemptStatus.INITIATED })).toBe(
      false,
    );
  });

  it('does not need a refund for a FAILED attempt', () => {
    expect(orderNeedsRefund({ status: PaymentAttemptStatus.FAILED })).toBe(
      false,
    );
  });
});

describe('assertTransitionAllowed', () => {
  it('does not throw for a legal transition (PAID -> CONFIRMED)', () => {
    expect(() =>
      assertTransitionAllowed(OrderStatus.PAID, OrderStatus.CONFIRMED),
    ).not.toThrow();
  });

  it('throws ConflictException for an illegal transition (PENDING_PAYMENT -> SHIPPED)', () => {
    expect(() =>
      assertTransitionAllowed(OrderStatus.PENDING_PAYMENT, OrderStatus.SHIPPED),
    ).toThrow(ConflictException);
  });

  it('throws ConflictException for a backwards transition (SHIPPED -> CONFIRMED)', () => {
    expect(() =>
      assertTransitionAllowed(OrderStatus.SHIPPED, OrderStatus.CONFIRMED),
    ).toThrow(ConflictException);
  });

  it('throws ConflictException out of a terminal state (REFUNDED -> anything)', () => {
    expect(() =>
      assertTransitionAllowed(OrderStatus.REFUNDED, OrderStatus.PAID),
    ).toThrow(ConflictException);
  });

  it('error message names the exact illegal transition attempted', () => {
    expect(() =>
      assertTransitionAllowed(OrderStatus.DELIVERED, OrderStatus.IN_PRODUCTION),
    ).toThrow('DELIVERED -> IN_PRODUCTION');
  });
});
