-- CreateEnum
CREATE TYPE "AuthorizationMethod" AS ENUM ('PIN', 'BIOMETRIC');

-- CreateEnum
CREATE TYPE "AuthorizationPurpose" AS ENUM ('WITHDRAWAL', 'AUTO_PAYOUT');

-- CreateTable
CREATE TABLE "driver_security" (
    "driverId" UUID NOT NULL,
    "pinHash" TEXT,
    "pinSetAt" TIMESTAMP(3),
    "pinChangedAt" TIMESTAMP(3),
    "failedPinAttempts" INTEGER NOT NULL DEFAULT 0,
    "pinLockedUntil" TIMESTAMP(3),
    "pinLockCount" INTEGER NOT NULL DEFAULT 0,
    "biometricEnabledAt" TIMESTAMP(3),
    "biometricDeviceRowId" UUID,
    "biometricSecretHash" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_security_pkey" PRIMARY KEY ("driverId")
);

-- CreateTable
CREATE TABLE "withdrawal_authorizations" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "deviceRowId" UUID NOT NULL,
    "method" "AuthorizationMethod" NOT NULL,
    "purpose" "AuthorizationPurpose" NOT NULL DEFAULT 'WITHDRAWAL',
    "quoteId" UUID,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "consumedByWithdrawalId" UUID,

    CONSTRAINT "withdrawal_authorizations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "withdrawal_authorizations_tokenHash_key" ON "withdrawal_authorizations"("tokenHash");

-- CreateIndex
CREATE INDEX "withdrawal_authorizations_driverId_createdAt_idx" ON "withdrawal_authorizations"("driverId", "createdAt");

-- CreateIndex
CREATE INDEX "withdrawal_authorizations_expiresAt_idx" ON "withdrawal_authorizations"("expiresAt");
