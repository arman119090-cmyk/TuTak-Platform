-- Phone-first OTP registration/login (item 3 of the follow-up directive).
--
-- Neither existing challenge table fits a brand-new phone number:
-- PhoneVerificationToken and PasswordResetToken are both userId-keyed, and
-- REGISTER has no User row yet. AuthOtpToken is phone-keyed instead, with
-- `purpose` scoping a code to REGISTER or LOGIN so one can't be replayed as
-- the other on the same number.

-- CreateEnum
CREATE TYPE "AuthOtpPurpose" AS ENUM ('REGISTER', 'LOGIN');

-- CreateTable
CREATE TABLE "auth_otp_tokens" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "purpose" "AuthOtpPurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_otp_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_otp_tokens_phone_purpose_consumedAt_idx" ON "auth_otp_tokens"("phone", "purpose", "consumedAt");

-- CreateIndex
CREATE INDEX "auth_otp_tokens_expiresAt_idx" ON "auth_otp_tokens"("expiresAt");
