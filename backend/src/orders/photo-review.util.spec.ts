import { OrderStatus, PhotoReviewStatus as S } from '@prisma/client';
import {
  isPhotoReviewGateEnforced,
  photoReviewWhere,
  summarisePhotoReview,
} from './photo-review.util';

describe('summarisePhotoReview', () => {
  it('is NONE with no photos, or photos not under review', () => {
    expect(summarisePhotoReview([])).toBe('NONE');
    expect(summarisePhotoReview([null])).toBe('NONE');
  });

  it('puts what the admin must do next first: TO_REVIEW, then CHANGES_REQUESTED, then APPROVED', () => {
    expect(summarisePhotoReview([S.APPROVED, S.PENDING])).toBe('TO_REVIEW');
    expect(summarisePhotoReview([S.APPROVED, S.CHANGES_REQUESTED])).toBe(
      'CHANGES_REQUESTED',
    );
    expect(summarisePhotoReview([S.APPROVED, S.APPROVED])).toBe('APPROVED');
    expect(
      summarisePhotoReview([S.PENDING, S.CHANGES_REQUESTED, S.APPROVED]),
    ).toBe('TO_REVIEW');
  });
});

describe('summarisePhotoReview — only paid orders are under review', () => {
  it.each([
    OrderStatus.PENDING_PAYMENT,
    OrderStatus.PAYMENT_FAILED,
    OrderStatus.CANCELLED,
    OrderStatus.REFUNDED,
  ])('is NONE for a %s order even if its photo is marked pending', (status) => {
    expect(summarisePhotoReview([S.PENDING], status)).toBe('NONE');
    expect(summarisePhotoReview([S.CHANGES_REQUESTED], status)).toBe('NONE');
  });

  it.each([
    OrderStatus.PAID,
    OrderStatus.CONFIRMED,
    OrderStatus.IN_PRODUCTION,
    OrderStatus.SHIPPED,
    OrderStatus.DELIVERED,
  ])('reads the photo state normally for a %s order', (status) => {
    expect(summarisePhotoReview([S.PENDING], status)).toBe('TO_REVIEW');
    expect(summarisePhotoReview([S.APPROVED], status)).toBe('APPROVED');
  });
});

describe('photoReviewWhere', () => {
  it('TO_REVIEW matches a pending photo on a paid order only', () => {
    expect(photoReviewWhere('TO_REVIEW')).toEqual({
      AND: [
        {
          status: {
            in: [
              OrderStatus.PAID,
              OrderStatus.CONFIRMED,
              OrderStatus.IN_PRODUCTION,
              OrderStatus.SHIPPED,
              OrderStatus.DELIVERED,
            ],
          },
        },
        {
          items: {
            some: { customizations: { some: { reviewStatus: S.PENDING } } },
          },
        },
      ],
    });
  });

  it('every review view is limited to paid orders, so unpaid and cancelled ones never queue up', () => {
    for (const view of [
      'TO_REVIEW',
      'CHANGES_REQUESTED',
      'APPROVED',
    ] as const) {
      const json = JSON.stringify(photoReviewWhere(view));
      expect(json).toContain(
        '"status":{"in":["PAID","CONFIRMED","IN_PRODUCTION","SHIPPED","DELIVERED"]}',
      );
    }
  });

  it('APPROVED excludes orders that still have a pending or changes-requested photo', () => {
    const where = photoReviewWhere('APPROVED') as { AND: unknown[] };
    expect(where.AND).toHaveLength(4);
    expect(JSON.stringify(where)).toContain('NOT');
  });

  it('NONE matches orders with no reviewed photo, and orders that are not in a reviewable state', () => {
    const where = photoReviewWhere('NONE') as { OR: unknown[] };
    expect(where.OR).toHaveLength(2);
    const json = JSON.stringify(where);
    expect(json).toContain('"reviewStatus":{"not":null}');
    expect(json).toContain('"NOT":{"status"');
  });
});

describe('isPhotoReviewGateEnforced', () => {
  it('is off unless explicitly set to "enforced"', () => {
    expect(isPhotoReviewGateEnforced({})).toBe(false);
    expect(isPhotoReviewGateEnforced({ PHOTO_REVIEW_GATE: 'off' })).toBe(false);
    expect(isPhotoReviewGateEnforced({ PHOTO_REVIEW_GATE: 'true' })).toBe(
      false,
    );
    expect(isPhotoReviewGateEnforced({ PHOTO_REVIEW_GATE: 'enforced' })).toBe(
      true,
    );
  });
});
