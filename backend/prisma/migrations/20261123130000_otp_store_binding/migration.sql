-- Additive scope for the approved legacy User OTP flow (P9-D1).
-- Existing unbound phone-only identities require an explicit, audited reconciliation.
ALTER TABLE "users" ADD COLUMN "otpStoreId" TEXT;
ALTER TABLE "otp_challenges" ADD COLUMN "storeId" TEXT;
