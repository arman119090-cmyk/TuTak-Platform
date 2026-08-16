-- CreateEnum
CREATE TYPE "PurchaseIntentStatus" AS ENUM ('AWAITING_CONFIRMATION', 'CONFIRMED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PartnerStatus" AS ENUM ('PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PartnerIntegrationType" AS ENUM ('QR_PURCHASE', 'WEBSITE', 'API', 'POS', 'EV_CHARGING', 'OCPI');

-- CreateEnum
CREATE TYPE "PartnerIntegrationStatus" AS ENUM ('NOT_CONNECTED', 'PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ReferrerType" AS ENUM ('USER', 'PARTNER');

-- CreateEnum
CREATE TYPE "DeferredBonusLotStatus" AS ENUM ('DEFERRED', 'AVAILABLE', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ReferralChallengeParticipantStatus" AS ENUM ('IN_PROGRESS', 'QUALIFIED', 'REWARDED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'PURCHASE_INTENT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'PURCHASE_INTENT_CONFIRMED';
ALTER TYPE "AuditAction" ADD VALUE 'PURCHASE_INTENT_REJECTED';
ALTER TYPE "AuditAction" ADD VALUE 'PURCHASE_INTENT_EXPIRED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BonusEntryType" ADD VALUE 'ACCRUAL_DEFERRED';
ALTER TYPE "BonusEntryType" ADD VALUE 'REDEMPTION_PARTNER_PURCHASE';

-- AlterEnum
ALTER TYPE "PermissionName" ADD VALUE 'PURCHASE_INTENT_CONFIRM';

-- AlterEnum
ALTER TYPE "RoleName" ADD VALUE 'PARTNER_MANAGER';

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'PARTNER_PURCHASE';

-- AlterTable
ALTER TABLE "partners" ADD COLUMN     "maxBonusPaymentPercent" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "status" "PartnerStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "referral_codes" ADD COLUMN     "partnerId" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "referral_invites" ADD COLUMN     "referrerPartnerId" TEXT,
ADD COLUMN     "referrerType" "ReferrerType" NOT NULL DEFAULT 'USER',
ALTER COLUMN "referrerUserId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "purchase_intents" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "partnerBranchId" TEXT,
    "status" "PurchaseIntentStatus" NOT NULL DEFAULT 'AWAITING_CONFIRMATION',
    "grossAmount" DECIMAL(18,4) NOT NULL,
    "bonusAmountRequested" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "ordinaryPaymentRemainder" DECIMAL(18,4) NOT NULL,
    "negotiatedRateBps" INTEGER NOT NULL,
    "maxBonusPaymentPercent" INTEGER NOT NULL,
    "bonusReservationId" TEXT,
    "sourceTransactionId" TEXT,
    "confirmedByUserId" TEXT,
    "rejectionReason" TEXT,
    "confirmationIdempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),

    CONSTRAINT "purchase_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_integrations" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "partnerBranchId" TEXT,
    "type" "PartnerIntegrationType" NOT NULL,
    "status" "PartnerIntegrationStatus" NOT NULL DEFAULT 'NOT_CONNECTED',
    "configuration" JSONB,
    "websiteUrl" TEXT,
    "websiteVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deferred_bonus_lots" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceTransactionId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "status" "DeferredBonusLotStatus" NOT NULL DEFAULT 'DEFERRED',
    "requiredTurnover" DECIMAL(18,4) NOT NULL,
    "progressTurnover" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadline" TIMESTAMP(3) NOT NULL,
    "unlockedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "grantedBonusLotId" TEXT,

    CONSTRAINT "deferred_bonus_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_challenge_participants" (
    "id" TEXT NOT NULL,
    "referrerUserId" TEXT NOT NULL,
    "refereeUserId" TEXT NOT NULL,
    "status" "ReferralChallengeParticipantStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "requiredAmount" DECIMAL(18,4) NOT NULL,
    "progressAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "qualifiedAt" TIMESTAMP(3),
    "rewardedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_challenge_participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_intents_confirmationIdempotencyKey_key" ON "purchase_intents"("confirmationIdempotencyKey");

-- CreateIndex
CREATE INDEX "purchase_intents_partnerId_status_idx" ON "purchase_intents"("partnerId", "status");

-- CreateIndex
CREATE INDEX "purchase_intents_status_expiresAt_idx" ON "purchase_intents"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "purchase_intents_customerId_status_idx" ON "purchase_intents"("customerId", "status");

-- CreateIndex
CREATE INDEX "partner_integrations_partnerId_idx" ON "partner_integrations"("partnerId");

-- CreateIndex
CREATE INDEX "deferred_bonus_lots_userId_status_idx" ON "deferred_bonus_lots"("userId", "status");

-- CreateIndex
CREATE INDEX "deferred_bonus_lots_status_deadline_idx" ON "deferred_bonus_lots"("status", "deadline");

-- CreateIndex
CREATE UNIQUE INDEX "referral_challenge_participants_refereeUserId_key" ON "referral_challenge_participants"("refereeUserId");

-- CreateIndex
CREATE INDEX "referral_challenge_participants_referrerUserId_status_idx" ON "referral_challenge_participants"("referrerUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "referral_codes_partnerId_key" ON "referral_codes"("partnerId");

-- CreateIndex
CREATE INDEX "referral_invites_referrerPartnerId_idx" ON "referral_invites"("referrerPartnerId");

-- AddForeignKey
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_partnerBranchId_fkey" FOREIGN KEY ("partnerBranchId") REFERENCES "partner_branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_integrations" ADD CONSTRAINT "partner_integrations_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_integrations" ADD CONSTRAINT "partner_integrations_partnerBranchId_fkey" FOREIGN KEY ("partnerBranchId") REFERENCES "partner_branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_invites" ADD CONSTRAINT "referral_invites_referrerPartnerId_fkey" FOREIGN KEY ("referrerPartnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deferred_bonus_lots" ADD CONSTRAINT "deferred_bonus_lots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_challenge_participants" ADD CONSTRAINT "referral_challenge_participants_referrerUserId_fkey" FOREIGN KEY ("referrerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_challenge_participants" ADD CONSTRAINT "referral_challenge_participants_refereeUserId_fkey" FOREIGN KEY ("refereeUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

