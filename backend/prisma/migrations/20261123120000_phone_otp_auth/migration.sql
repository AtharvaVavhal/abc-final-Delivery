-- Phone-OTP customer login (docs/architecture/PHONE-OTP-AUTH-DESIGN.md).
-- Additive only, hand-written (see the Phase 8 migration for why Prisma's
-- generated diff is not used in this repo). Existing rows are untouched.

-- AlterTable: customers may sign in by phone only, with no email/password.
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "users" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "users" ADD COLUMN "phoneE164" TEXT;
ALTER TABLE "users" ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "users_phoneE164_key" ON "users"("phoneE164");

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" TEXT NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "requestIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "otp_challenges_phoneE164_createdAt_idx" ON "otp_challenges"("phoneE164", "createdAt");

-- CreateIndex
CREATE INDEX "otp_challenges_createdAt_idx" ON "otp_challenges"("createdAt");
