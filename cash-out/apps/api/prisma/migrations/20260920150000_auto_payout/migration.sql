-- CreateEnum
CREATE TYPE "AutoPayoutCadence" AS ENUM ('ON_THRESHOLD', 'DAILY', 'WEEKLY');

-- AlterTable
ALTER TABLE "withdrawals" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'DRIVER',
ADD COLUMN "autoPayoutRuleId" UUID;

-- CreateTable
CREATE TABLE "auto_payout_rules" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "parkId" UUID NOT NULL,
    "payoutMethodId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "cadence" "AutoPayoutCadence" NOT NULL DEFAULT 'ON_THRESHOLD',
    "currency" TEXT NOT NULL DEFAULT 'AMD',
    "thresholdMinor" BIGINT NOT NULL,
    "maxPayoutMinor" BIGINT,
    "runHour" INTEGER,
    "runWeekday" INTEGER,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Yerevan',
    "nextCheckAt" TIMESTAMP(3) NOT NULL,
    "lastCheckedAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastWithdrawalId" UUID,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastFailureCode" TEXT,
    "lastFailureAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "pausedReason" TEXT,
    "authorizationMethod" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auto_payout_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auto_payout_rules_driverId_key" ON "auto_payout_rules"("driverId");

-- CreateIndex
CREATE INDEX "auto_payout_rules_enabled_pausedAt_nextCheckAt_idx" ON "auto_payout_rules"("enabled", "pausedAt", "nextCheckAt");
