-- Optional delivery pin on an order (customer opt-in; cleared after delivery).
-- Additive only (migration-safety guard G-10): one nullable column per statement.

ALTER TABLE "orders" ADD COLUMN "shippingLatitude" DOUBLE PRECISION;
ALTER TABLE "orders" ADD COLUMN "shippingLongitude" DOUBLE PRECISION;
