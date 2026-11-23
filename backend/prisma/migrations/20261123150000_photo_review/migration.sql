-- Admin photo review (docs/architecture/ADMIN-PHOTO-REVIEW-DESIGN.md), phase 1.
-- Additive only (migration-safety guard G-10): one nullable column per
-- statement, no data changes. Existing rows keep reviewStatus NULL = "not
-- under review"; see the design doc (section 4) for the optional one-off
-- backfill for environments that already have paid orders with photos.

CREATE TYPE "PhotoReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'CHANGES_REQUESTED');

ALTER TABLE "order_item_customizations" ADD COLUMN "reviewStatus" "PhotoReviewStatus";
ALTER TABLE "order_item_customizations" ADD COLUMN "reviewNote" TEXT;
ALTER TABLE "order_item_customizations" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "order_item_customizations" ADD COLUMN "reviewedByUserId" TEXT;

ALTER TABLE "uploaded_files" ADD COLUMN "width" INTEGER;
ALTER TABLE "uploaded_files" ADD COLUMN "height" INTEGER;
