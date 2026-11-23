import { PhotoReviewStatus as S } from '@prisma/client';
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

describe('photoReviewWhere', () => {
  it('TO_REVIEW matches any pending photo', () => {
    expect(photoReviewWhere('TO_REVIEW')).toEqual({
      items: {
        some: { customizations: { some: { reviewStatus: S.PENDING } } },
      },
    });
  });

  it('APPROVED excludes orders that still have a pending or changes-requested photo', () => {
    const where = photoReviewWhere('APPROVED') as { AND: unknown[] };
    expect(where.AND).toHaveLength(3);
    expect(JSON.stringify(where)).toContain('NOT');
  });

  it('NONE matches orders with no reviewed photo at all', () => {
    expect(photoReviewWhere('NONE')).toEqual({
      NOT: {
        items: {
          some: {
            customizations: { some: { reviewStatus: { not: null } } },
          },
        },
      },
    });
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
