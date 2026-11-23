import { OrderStatus, PhotoReviewStatus, Prisma } from '@prisma/client';

/** What an order's photos add up to, for the admin list and filter.
 * Precedence is "what the admin must do next": anything still to look at
 * wins, then anything waiting on the customer, then approved. */
export type PhotoReviewSummary =
  'NONE' | 'TO_REVIEW' | 'CHANGES_REQUESTED' | 'APPROVED';

export const PHOTO_REVIEW_FILTERS = [
  'NONE',
  'TO_REVIEW',
  'CHANGES_REQUESTED',
  'APPROVED',
] as const satisfies readonly PhotoReviewSummary[];

/** A photo is only under review once the order is paid. A new order's photos
 * start as PENDING at checkout, so an unpaid, failed, cancelled or refunded
 * order must not read as "to review" (and must not appear in the review
 * queue) however its photo rows happen to be marked. */
export const PHOTO_REVIEW_ORDER_STATUSES: readonly OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.CONFIRMED,
  OrderStatus.IN_PRODUCTION,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
];

/** `statuses` are the review states of the order's FILE customizations
 * (`null` = a file row that is not under review). `orderStatus` is the
 * order's own status; omit it only where the order is known to be paid. */
export function summarisePhotoReview(
  statuses: readonly (PhotoReviewStatus | null)[],
  orderStatus?: OrderStatus,
): PhotoReviewSummary {
  if (orderStatus && !PHOTO_REVIEW_ORDER_STATUSES.includes(orderStatus)) {
    return 'NONE';
  }
  if (statuses.includes(PhotoReviewStatus.PENDING)) return 'TO_REVIEW';
  if (statuses.includes(PhotoReviewStatus.CHANGES_REQUESTED)) {
    return 'CHANGES_REQUESTED';
  }
  if (statuses.includes(PhotoReviewStatus.APPROVED)) return 'APPROVED';
  return 'NONE';
}

const hasCustomization = (
  where: Prisma.OrderItemCustomizationWhereInput,
): Prisma.OrderWhereInput => ({
  items: { some: { customizations: { some: where } } },
});

/** The Prisma `where` that matches {@link summarisePhotoReview}'s result. */
export function photoReviewWhere(
  filter: PhotoReviewSummary,
): Prisma.OrderWhereInput {
  const pending = hasCustomization({
    reviewStatus: PhotoReviewStatus.PENDING,
  });
  const changes = hasCustomization({
    reviewStatus: PhotoReviewStatus.CHANGES_REQUESTED,
  });
  const approved = hasCustomization({
    reviewStatus: PhotoReviewStatus.APPROVED,
  });
  const paid: Prisma.OrderWhereInput = {
    status: { in: [...PHOTO_REVIEW_ORDER_STATUSES] },
  };
  switch (filter) {
    case 'TO_REVIEW':
      return { AND: [paid, pending] };
    case 'CHANGES_REQUESTED':
      return { AND: [paid, changes, { NOT: pending }] };
    case 'APPROVED':
      return { AND: [paid, approved, { NOT: pending }, { NOT: changes }] };
    case 'NONE':
      // No reviewed photo at all, or the order is not in a state where photos
      // are reviewed (unpaid / failed / cancelled / refunded).
      return {
        OR: [
          { NOT: paid },
          { NOT: hasCustomization({ reviewStatus: { not: null } }) },
        ],
      };
  }
}

/** The production gate is OFF unless explicitly enabled. It must stay off
 * until the admin UI can approve photos — otherwise a new order with a photo
 * could not be moved into production. */
export function isPhotoReviewGateEnforced(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.PHOTO_REVIEW_GATE === 'enforced';
}

export const PHOTO_REVIEW_BLOCKS_PRODUCTION_MESSAGE =
  'This order has a photo that has not been approved yet. Approve it, or ask the customer for a new one, before starting production.';
