-- CreateEnum
CREATE TYPE "ParkStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REMOVED');

-- CreateEnum
CREATE TYPE "MembershipEligibility" AS ENUM ('ELIGIBLE', 'INELIGIBLE', 'PENDING_REVIEW');

-- CreateEnum
CREATE TYPE "MembershipSource" AS ENUM ('ROSTER_IMPORT', 'YANDEX_SYNC', 'ADMIN');

-- CreateEnum
CREATE TYPE "DriverIdChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- DropIndex
DROP INDEX "balance_snapshots_driverId_fetchedAt_idx";

-- DropIndex
DROP INDEX "drivers_parkId_yandexContractorProfileId_key";

-- Balance snapshots are a cache; rows written before parks existed cannot be
-- attributed to one and are dropped rather than guessed.
DELETE FROM "balance_snapshots";

-- AlterTable
ALTER TABLE "balance_snapshots" ADD COLUMN     "parkId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "drivers" DROP COLUMN "parkId",
DROP COLUMN "yandexContractorProfileId",
ADD COLUMN     "activeMembershipId" UUID;

-- Before parks were modelled, "parkId" held the Yandex park id itself; keep it
-- as the external id so history stays answerable.
ALTER TABLE "withdrawals" ADD COLUMN     "yandexParkId" TEXT;
UPDATE "withdrawals" SET "yandexParkId" = "parkId";
ALTER TABLE "withdrawals" ALTER COLUMN "yandexParkId" SET NOT NULL;

-- CreateTable
CREATE TABLE "parks" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "yandexParkId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AMD',
    "status" "ParkStatus" NOT NULL DEFAULT 'ACTIVE',
    "suspendedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByAdminId" UUID,

    CONSTRAINT "parks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "park_integration_credentials" (
    "id" UUID NOT NULL,
    "parkId" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'YANDEX_FLEET',
    "clientId" TEXT NOT NULL,
    "apiKeyEnc" TEXT NOT NULL,
    "apiKeyHint" TEXT NOT NULL,
    "lastVerifiedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByAdminId" UUID,

    CONSTRAINT "park_integration_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_park_memberships" (
    "id" UUID NOT NULL,
    "parkId" UUID NOT NULL,
    "driverId" UUID,
    "phone" TEXT NOT NULL,
    "externalProfileId" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "eligibility" "MembershipEligibility" NOT NULL DEFAULT 'ELIGIBLE',
    "eligibilityReason" TEXT,
    "source" "MembershipSource" NOT NULL DEFAULT 'ROSTER_IMPORT',
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_park_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "park_switches" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "fromParkId" UUID,
    "toParkId" UUID NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "park_switches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roster_imports" (
    "id" UUID NOT NULL,
    "parkId" UUID NOT NULL,
    "source" "MembershipSource" NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "createdCount" INTEGER NOT NULL,
    "updatedCount" INTEGER NOT NULL,
    "skippedCount" INTEGER NOT NULL,
    "errors" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByAdminId" UUID,

    CONSTRAINT "roster_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_id_change_requests" (
    "id" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "parkId" UUID NOT NULL,
    "previousExternalId" TEXT NOT NULL,
    "requestedExternalId" TEXT NOT NULL,
    "status" "DriverIdChangeStatus" NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL DEFAULT 'DRIVER',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedByAdminId" UUID,
    "decisionReason" TEXT,
    "verificationNote" TEXT,

    CONSTRAINT "driver_id_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "parks_code_key" ON "parks"("code");

-- CreateIndex
CREATE UNIQUE INDEX "parks_yandexParkId_key" ON "parks"("yandexParkId");

-- CreateIndex
CREATE INDEX "parks_status_idx" ON "parks"("status");

-- CreateIndex
CREATE UNIQUE INDEX "park_integration_credentials_parkId_key" ON "park_integration_credentials"("parkId");

-- CreateIndex
CREATE INDEX "driver_park_memberships_phone_idx" ON "driver_park_memberships"("phone");

-- CreateIndex
CREATE INDEX "driver_park_memberships_driverId_idx" ON "driver_park_memberships"("driverId");

-- CreateIndex
CREATE UNIQUE INDEX "driver_park_memberships_parkId_externalProfileId_key" ON "driver_park_memberships"("parkId", "externalProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "driver_park_memberships_parkId_phone_key" ON "driver_park_memberships"("parkId", "phone");

-- CreateIndex
CREATE INDEX "park_switches_driverId_at_idx" ON "park_switches"("driverId", "at");

-- CreateIndex
CREATE INDEX "roster_imports_parkId_createdAt_idx" ON "roster_imports"("parkId", "createdAt");

-- CreateIndex
CREATE INDEX "driver_id_change_requests_driverId_requestedAt_idx" ON "driver_id_change_requests"("driverId", "requestedAt");

-- CreateIndex
CREATE INDEX "driver_id_change_requests_status_requestedAt_idx" ON "driver_id_change_requests"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "balance_snapshots_driverId_parkId_fetchedAt_idx" ON "balance_snapshots"("driverId", "parkId", "fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_activeMembershipId_key" ON "drivers"("activeMembershipId");

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_activeMembershipId_fkey" FOREIGN KEY ("activeMembershipId") REFERENCES "driver_park_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "park_integration_credentials" ADD CONSTRAINT "park_integration_credentials_parkId_fkey" FOREIGN KEY ("parkId") REFERENCES "parks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_park_memberships" ADD CONSTRAINT "driver_park_memberships_parkId_fkey" FOREIGN KEY ("parkId") REFERENCES "parks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_park_memberships" ADD CONSTRAINT "driver_park_memberships_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "park_switches" ADD CONSTRAINT "park_switches_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_imports" ADD CONSTRAINT "roster_imports_parkId_fkey" FOREIGN KEY ("parkId") REFERENCES "parks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_id_change_requests" ADD CONSTRAINT "driver_id_change_requests_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "driver_park_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

