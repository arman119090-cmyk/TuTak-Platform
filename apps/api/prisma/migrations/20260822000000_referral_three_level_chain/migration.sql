-- Referral engine rework (2026-08-22): single-level -> 3-level upward
-- chain. Additive only, no backfill — every new column is nullable and a
-- pre-existing PurchaseIntent/EvSession row is left exactly as it was
-- (`programVersion` stays NULL, i.e. LEGACY_SINGLE_LEVEL in all but name).
-- This is the explicit, persisted eligibility boundary the rework requires:
-- nothing here is inferred later by comparing `createdAt` to a release date.

-- CreateEnum
CREATE TYPE "ReferralProgramVersion" AS ENUM ('LEGACY_SINGLE_LEVEL', 'THREE_LEVEL_V2');

-- AlterTable: purchase_intents — per-level referrer snapshot + program version.
ALTER TABLE "purchase_intents" ADD COLUMN "programVersion" "ReferralProgramVersion";
ALTER TABLE "purchase_intents" ADD COLUMN "referrer1Type" "ReferrerType";
ALTER TABLE "purchase_intents" ADD COLUMN "referrer1UserId" TEXT;
ALTER TABLE "purchase_intents" ADD COLUMN "referrer1PartnerId" TEXT;
ALTER TABLE "purchase_intents" ADD COLUMN "referrer1Amount" DECIMAL(18,4);
ALTER TABLE "purchase_intents" ADD COLUMN "referrer2Type" "ReferrerType";
ALTER TABLE "purchase_intents" ADD COLUMN "referrer2UserId" TEXT;
ALTER TABLE "purchase_intents" ADD COLUMN "referrer2PartnerId" TEXT;
ALTER TABLE "purchase_intents" ADD COLUMN "referrer2Amount" DECIMAL(18,4);
ALTER TABLE "purchase_intents" ADD COLUMN "referrer3Type" "ReferrerType";
ALTER TABLE "purchase_intents" ADD COLUMN "referrer3UserId" TEXT;
ALTER TABLE "purchase_intents" ADD COLUMN "referrer3PartnerId" TEXT;
ALTER TABLE "purchase_intents" ADD COLUMN "referrer3Amount" DECIMAL(18,4);
ALTER TABLE "purchase_intents" ADD COLUMN "tutakAmount" DECIMAL(18,4);

-- AlterTable: ev_sessions — same per-level referrer snapshot + program version.
ALTER TABLE "ev_sessions" ADD COLUMN "programVersion" "ReferralProgramVersion";
ALTER TABLE "ev_sessions" ADD COLUMN "referrer1Type" "ReferrerType";
ALTER TABLE "ev_sessions" ADD COLUMN "referrer1UserId" TEXT;
ALTER TABLE "ev_sessions" ADD COLUMN "referrer1PartnerId" TEXT;
ALTER TABLE "ev_sessions" ADD COLUMN "referrer1Amount" DECIMAL(18,4);
ALTER TABLE "ev_sessions" ADD COLUMN "referrer2Type" "ReferrerType";
ALTER TABLE "ev_sessions" ADD COLUMN "referrer2UserId" TEXT;
ALTER TABLE "ev_sessions" ADD COLUMN "referrer2PartnerId" TEXT;
ALTER TABLE "ev_sessions" ADD COLUMN "referrer2Amount" DECIMAL(18,4);
ALTER TABLE "ev_sessions" ADD COLUMN "referrer3Type" "ReferrerType";
ALTER TABLE "ev_sessions" ADD COLUMN "referrer3UserId" TEXT;
ALTER TABLE "ev_sessions" ADD COLUMN "referrer3PartnerId" TEXT;
ALTER TABLE "ev_sessions" ADD COLUMN "referrer3Amount" DECIMAL(18,4);
ALTER TABLE "ev_sessions" ADD COLUMN "tutakAmount" DECIMAL(18,4);
