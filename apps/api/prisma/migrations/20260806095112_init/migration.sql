-- CreateEnum
CREATE TYPE "RoleName" AS ENUM ('CUSTOMER', 'PARTNER_STAFF', 'PARTNER_OWNER', 'ADMIN', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "PermissionName" AS ENUM ('WALLET_READ', 'WALLET_WRITE', 'BONUS_RULE_MANAGE', 'PARTNER_MANAGE', 'PARTNER_TRANSACTIONS_READ', 'USER_MANAGE', 'ADMIN_AUDIT_READ', 'EV_STATION_MANAGE', 'QR_ISSUE', 'QR_REDEEM', 'ANALYTICS_READ');

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('IOS', 'ANDROID', 'WEB');

-- CreateEnum
CREATE TYPE "BonusLotStatus" AS ENUM ('PENDING', 'AVAILABLE', 'EXPIRED', 'CONSUMED');

-- CreateEnum
CREATE TYPE "BonusEntryType" AS ENUM ('ACCRUAL_PURCHASE', 'ACCRUAL_REFERRAL', 'ACCRUAL_PROMOTION', 'ACCRUAL_MANUAL_ADJUSTMENT', 'REDEMPTION_QR_PAYMENT', 'REDEMPTION_EV_CHARGING', 'EXPIRY', 'REVERSAL');

-- CreateEnum
CREATE TYPE "BonusReservationStatus" AS ENUM ('ACTIVE', 'SETTLED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('QR_PAYMENT', 'EV_CHARGING', 'BONUS_ACCRUAL', 'BONUS_REDEMPTION', 'REFERRAL_REWARD', 'REFUND', 'MANUAL_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('INITIATED', 'PENDING', 'COMPLETED', 'FAILED', 'REVERSED', 'FLAGGED');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('AMD', 'BONUS_POINT');

-- CreateEnum
CREATE TYPE "QrCodeType" AS ENUM ('STATIC_MERCHANT', 'DYNAMIC_INVOICE', 'USER_PAY_TOKEN');

-- CreateEnum
CREATE TYPE "QrCodeStatus" AS ENUM ('ACTIVE', 'REDEEMED', 'EXPIRED', 'VOID');

-- CreateEnum
CREATE TYPE "ReferralInviteStatus" AS ENUM ('PENDING', 'QUALIFIED', 'REWARDED', 'EXPIRED', 'FRAUD_BLOCKED');

-- CreateEnum
CREATE TYPE "EvConnectorType" AS ENUM ('TYPE_2', 'CCS2', 'CHADEMO', 'GBT_DC');

-- CreateEnum
CREATE TYPE "EvConnectorStatus" AS ENUM ('AVAILABLE', 'BLOCKED', 'CHARGING', 'INOPERATIVE', 'OUTOFORDER', 'PLANNED', 'REMOVED', 'RESERVED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "EvSessionStatus" AS ENUM ('RESERVED', 'AUTHORIZED', 'CHARGING', 'SUSPENDED', 'COMPLETED', 'INVALID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EvReservationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED', 'FULFILLED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('PUSH', 'SMS', 'EMAIL', 'IN_APP');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('USER_LOGIN', 'USER_LOGIN_FAILED', 'USER_LOGOUT', 'TOKEN_REFRESHED', 'TOKEN_REVOKED', 'BONUS_ACCRUED', 'BONUS_RESERVED', 'BONUS_SETTLED', 'BONUS_EXPIRED', 'BONUS_REVERSED', 'BONUS_MANUAL_ADJUSTMENT', 'QR_ISSUED', 'QR_REDEEMED', 'EV_SESSION_STARTED', 'EV_SESSION_STOPPED', 'PARTNER_CREATED', 'PARTNER_UPDATED', 'ADMIN_ROLE_CHANGED', 'FRAUD_FLAGGED', 'ACCOUNT_LOCKED');

-- CreateEnum
CREATE TYPE "FraudSignalType" AS ENUM ('VELOCITY_LIMIT_EXCEEDED', 'IMPOSSIBLE_TRAVEL', 'DEVICE_MISMATCH', 'QR_REPLAY_ATTEMPT', 'BONUS_ABUSE_PATTERN', 'REFERRAL_RING_DETECTED');

-- CreateEnum
CREATE TYPE "FraudSignalSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "name" "RoleName" NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "name" "PermissionName" NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "partnerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'hy',
    "isPhoneVerified" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "deviceName" TEXT,
    "pushToken" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedByTokenId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "availableBonus" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "pendingBonus" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reservedBonus" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lifetimeEarned" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lifetimeSpent" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bonus_lots" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" "BonusEntryType" NOT NULL,
    "status" "BonusLotStatus" NOT NULL DEFAULT 'PENDING',
    "originalAmount" DECIMAL(18,4) NOT NULL,
    "remainingAmount" DECIMAL(18,4) NOT NULL,
    "sourceTransactionId" TEXT,
    "availableAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bonus_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bonus_reservations" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "status" "BonusReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "reasonTransactionId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bonus_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bonus_reservation_allocations" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "bonus_reservation_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bonus_ledger_entries" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" "BonusEntryType" NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "balanceAfter" DECIMAL(18,4) NOT NULL,
    "relatedLotId" TEXT,
    "relatedReservationId" TEXT,
    "sourceTransactionId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bonus_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "partnerId" TEXT,
    "type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'INITIATED',
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'AMD',
    "bonusAppliedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "bonusEarnedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "description" TEXT,
    "idempotencyKey" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qr_codes" (
    "id" TEXT NOT NULL,
    "type" "QrCodeType" NOT NULL,
    "status" "QrCodeStatus" NOT NULL DEFAULT 'ACTIVE',
    "token" TEXT NOT NULL,
    "issuedByUserId" TEXT,
    "partnerId" TEXT,
    "amount" DECIMAL(18,4),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "redeemedTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qr_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partners" (
    "id" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "taxId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "bonusAccrualRateBps" INTEGER NOT NULL DEFAULT 300,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_memberships" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_branches" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_invites" (
    "id" TEXT NOT NULL,
    "referrerUserId" TEXT NOT NULL,
    "refereeUserId" TEXT NOT NULL,
    "status" "ReferralInviteStatus" NOT NULL DEFAULT 'PENDING',
    "qualifyingAction" TEXT,
    "rewardAmount" DECIMAL(18,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "qualifiedAt" TIMESTAMP(3),
    "rewardedAt" TIMESTAMP(3),

    CONSTRAINT "referral_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ev_stations" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "ocpiLocationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ev_stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ev_connectors" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "ocpiEvseUid" TEXT,
    "connectorType" "EvConnectorType" NOT NULL,
    "status" "EvConnectorStatus" NOT NULL DEFAULT 'AVAILABLE',
    "powerKw" DECIMAL(8,2) NOT NULL,
    "pricePerKwh" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ev_connectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ev_sessions" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reservationId" TEXT,
    "status" "EvSessionStatus" NOT NULL DEFAULT 'AUTHORIZED',
    "startedAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "energyKwh" DECIMAL(10,3),
    "cost" DECIMAL(18,4),
    "bonusEarnedAmount" DECIMAL(18,4),
    "transactionId" TEXT,
    "ocpiCdrId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ev_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ev_reservations" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "EvReservationStatus" NOT NULL DEFAULT 'PENDING',
    "startAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ev_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ev_cdrs" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "ocpiCdrId" TEXT,
    "totalEnergy" DECIMAL(10,3) NOT NULL,
    "totalCost" DECIMAL(18,4) NOT NULL,
    "totalTimeSec" INTEGER NOT NULL,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ev_cdrs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "titleKey" TEXT NOT NULL,
    "bodyKey" TEXT NOT NULL,
    "params" JSONB,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_signals" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "type" "FraudSignalType" NOT NULL,
    "severity" "FraudSignalSeverity" NOT NULL,
    "relatedTransactionId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,

    CONSTRAINT "fraud_signals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_name_key" ON "permissions"("name");

-- CreateIndex
CREATE INDEX "user_roles_userId_idx" ON "user_roles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_userId_roleId_partnerId_key" ON "user_roles"("userId", "roleId", "partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_createdAt_idx" ON "users"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "devices_userId_deviceId_key" ON "devices"("userId", "deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_userId_key" ON "wallets"("userId");

-- CreateIndex
CREATE INDEX "bonus_lots_walletId_status_idx" ON "bonus_lots"("walletId", "status");

-- CreateIndex
CREATE INDEX "bonus_lots_expiresAt_idx" ON "bonus_lots"("expiresAt");

-- CreateIndex
CREATE INDEX "bonus_reservations_walletId_status_idx" ON "bonus_reservations"("walletId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bonus_reservation_allocations_reservationId_lotId_key" ON "bonus_reservation_allocations"("reservationId", "lotId");

-- CreateIndex
CREATE INDEX "bonus_ledger_entries_walletId_createdAt_idx" ON "bonus_ledger_entries"("walletId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_idempotencyKey_key" ON "transactions"("idempotencyKey");

-- CreateIndex
CREATE INDEX "transactions_userId_createdAt_idx" ON "transactions"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "transactions_partnerId_createdAt_idx" ON "transactions"("partnerId", "createdAt");

-- CreateIndex
CREATE INDEX "transactions_type_status_idx" ON "transactions"("type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "qr_codes_token_key" ON "qr_codes"("token");

-- CreateIndex
CREATE UNIQUE INDEX "qr_codes_redeemedTransactionId_key" ON "qr_codes"("redeemedTransactionId");

-- CreateIndex
CREATE INDEX "qr_codes_status_expiresAt_idx" ON "qr_codes"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "partners_taxId_key" ON "partners"("taxId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_memberships_partnerId_userId_key" ON "partner_memberships"("partnerId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "referral_codes_userId_key" ON "referral_codes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "referral_codes_code_key" ON "referral_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "referral_invites_refereeUserId_key" ON "referral_invites"("refereeUserId");

-- CreateIndex
CREATE INDEX "referral_invites_referrerUserId_idx" ON "referral_invites"("referrerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ev_stations_ocpiLocationId_key" ON "ev_stations"("ocpiLocationId");

-- CreateIndex
CREATE UNIQUE INDEX "ev_connectors_ocpiEvseUid_key" ON "ev_connectors"("ocpiEvseUid");

-- CreateIndex
CREATE INDEX "ev_connectors_status_idx" ON "ev_connectors"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ev_sessions_reservationId_key" ON "ev_sessions"("reservationId");

-- CreateIndex
CREATE UNIQUE INDEX "ev_sessions_transactionId_key" ON "ev_sessions"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "ev_sessions_ocpiCdrId_key" ON "ev_sessions"("ocpiCdrId");

-- CreateIndex
CREATE INDEX "ev_sessions_userId_createdAt_idx" ON "ev_sessions"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ev_sessions_connectorId_status_idx" ON "ev_sessions"("connectorId", "status");

-- CreateIndex
CREATE INDEX "ev_reservations_connectorId_status_idx" ON "ev_reservations"("connectorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ev_cdrs_sessionId_key" ON "ev_cdrs"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "ev_cdrs_ocpiCdrId_key" ON "ev_cdrs"("ocpiCdrId");

-- CreateIndex
CREATE INDEX "notifications_userId_isRead_idx" ON "notifications"("userId", "isRead");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_createdAt_idx" ON "audit_logs"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");

-- CreateIndex
CREATE INDEX "fraud_signals_userId_createdAt_idx" ON "fraud_signals"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonus_lots" ADD CONSTRAINT "bonus_lots_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonus_reservations" ADD CONSTRAINT "bonus_reservations_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonus_reservation_allocations" ADD CONSTRAINT "bonus_reservation_allocations_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "bonus_reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonus_reservation_allocations" ADD CONSTRAINT "bonus_reservation_allocations_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "bonus_lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonus_ledger_entries" ADD CONSTRAINT "bonus_ledger_entries_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_redeemedTransactionId_fkey" FOREIGN KEY ("redeemedTransactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_memberships" ADD CONSTRAINT "partner_memberships_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_memberships" ADD CONSTRAINT "partner_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_branches" ADD CONSTRAINT "partner_branches_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_invites" ADD CONSTRAINT "referral_invites_referrerUserId_fkey" FOREIGN KEY ("referrerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_invites" ADD CONSTRAINT "referral_invites_refereeUserId_fkey" FOREIGN KEY ("refereeUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ev_stations" ADD CONSTRAINT "ev_stations_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ev_connectors" ADD CONSTRAINT "ev_connectors_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "ev_stations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ev_sessions" ADD CONSTRAINT "ev_sessions_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "ev_connectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ev_sessions" ADD CONSTRAINT "ev_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ev_sessions" ADD CONSTRAINT "ev_sessions_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "ev_reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ev_sessions" ADD CONSTRAINT "ev_sessions_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ev_reservations" ADD CONSTRAINT "ev_reservations_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "ev_connectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ev_reservations" ADD CONSTRAINT "ev_reservations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ev_cdrs" ADD CONSTRAINT "ev_cdrs_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ev_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_signals" ADD CONSTRAINT "fraud_signals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
