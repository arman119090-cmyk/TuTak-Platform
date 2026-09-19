-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "DriverVerificationStatus" AS ENUM ('UNLINKED', 'PENDING', 'VERIFIED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "PayoutMethodKind" AS ENUM ('CARD', 'BANK_ACCOUNT');

-- CreateEnum
CREATE TYPE "PayoutMethodStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'REJECTED', 'DISABLED');

-- CreateEnum
CREATE TYPE "WithdrawalState" AS ENUM ('CREATED', 'RISK_CHECK', 'RISK_REVIEW', 'REJECTED', 'RESERVING', 'RESERVE_UNCERTAIN', 'RESERVED', 'PAYOUT_SUBMITTING', 'PAYOUT_UNCERTAIN', 'PAYOUT_SUBMITTED', 'PAYOUT_CONFIRMED', 'COMPLETED', 'PAYOUT_FAILED', 'PAYOUT_RETURNED', 'COMPENSATING', 'REVERSED', 'FAILED', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('PARK_RECEIVABLE', 'DRIVER_PAYABLE', 'PSP_SETTLEMENT', 'PLATFORM_FEE_REVENUE', 'PROVIDER_FEE_REVENUE', 'PROVIDER_FEE_EXPENSE', 'SUSPENSE');

-- CreateEnum
CREATE TYPE "JournalEntryType" AS ENUM ('WITHDRAWAL_RESERVE', 'FEE_CAPTURE', 'PAYOUT_SETTLEMENT', 'PROVIDER_COST', 'COMPENSATION', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ReconciliationKind" AS ENUM ('YANDEX', 'PROVIDER', 'LEDGER');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('VIEWER', 'OPERATOR', 'FINANCE', 'ADMIN');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'hy',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "deviceId" TEXT NOT NULL,
    "name" TEXT,
    "platform" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blocked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "deviceRowId" UUID NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "familyId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "ip" TEXT,
    "deliveryFailed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "parkId" TEXT,
    "yandexContractorProfileId" TEXT,
    "verificationStatus" "DriverVerificationStatus" NOT NULL DEFAULT 'UNLINKED',
    "firstName" TEXT,
    "lastName" TEXT,
    "currency" TEXT,
    "licenceLast4Hash" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "blockedAt" TIMESTAMP(3),
    "blockReason" TEXT,
    "riskTier" TEXT NOT NULL DEFAULT 'STANDARD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "balance_snapshots" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "balanceMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "yandexAccountId" TEXT,

    CONSTRAINT "balance_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_methods" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "kind" "PayoutMethodKind" NOT NULL,
    "status" "PayoutMethodStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "currency" TEXT NOT NULL,
    "providerTokenEnc" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "maskedIdentifier" TEXT NOT NULL,
    "displayName" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "disabledAt" TIMESTAMP(3),
    "rejectedReason" TEXT,

    CONSTRAINT "payout_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_schedules" (
    "id" UUID NOT NULL,
    "parkId" TEXT,
    "currency" TEXT NOT NULL,
    "platformRateNumerator" BIGINT NOT NULL,
    "platformRateDenominator" BIGINT NOT NULL,
    "platformFixedMinor" BIGINT NOT NULL,
    "platformMinMinor" BIGINT,
    "platformMaxMinor" BIGINT,
    "platformRounding" TEXT NOT NULL DEFAULT 'HALF_UP',
    "providerRateNumerator" BIGINT NOT NULL,
    "providerRateDenominator" BIGINT NOT NULL,
    "providerFixedMinor" BIGINT NOT NULL,
    "providerMinMinor" BIGINT,
    "providerMaxMinor" BIGINT,
    "providerRounding" TEXT NOT NULL DEFAULT 'HALF_UP',
    "payoutIncrementMinor" BIGINT NOT NULL DEFAULT 1,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByAdminId" UUID,

    CONSTRAINT "fee_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "limit_policies" (
    "id" UUID NOT NULL,
    "parkId" TEXT,
    "currency" TEXT NOT NULL,
    "minWithdrawalMinor" BIGINT NOT NULL,
    "maxWithdrawalMinor" BIGINT NOT NULL,
    "dailyAmountMinor" BIGINT NOT NULL,
    "dailyCountMax" INTEGER NOT NULL,
    "weeklyAmountMinor" BIGINT NOT NULL,
    "monthlyAmountMinor" BIGINT NOT NULL,
    "velocityWindowSeconds" INTEGER NOT NULL DEFAULT 3600,
    "velocityMaxCount" INTEGER NOT NULL DEFAULT 3,
    "manualReviewAboveMinor" BIGINT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByAdminId" UUID,

    CONSTRAINT "limit_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "payoutMethodId" UUID NOT NULL,
    "currency" TEXT NOT NULL,
    "grossMinor" BIGINT NOT NULL,
    "platformFeeMinor" BIGINT NOT NULL,
    "providerFeeMinor" BIGINT NOT NULL,
    "netMinor" BIGINT NOT NULL,
    "balanceAtQuoteMinor" BIGINT NOT NULL,
    "feeScheduleId" UUID NOT NULL,
    "signature" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "consumedByWithdrawalId" UUID,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawals" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "driverId" UUID NOT NULL,
    "payoutMethodId" UUID NOT NULL,
    "quoteId" UUID,
    "state" "WithdrawalState" NOT NULL DEFAULT 'CREATED',
    "version" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "grossMinor" BIGINT NOT NULL,
    "platformFeeMinor" BIGINT NOT NULL,
    "providerFeeMinor" BIGINT NOT NULL,
    "netMinor" BIGINT NOT NULL,
    "parkId" TEXT NOT NULL,
    "yandexContractorProfileId" TEXT NOT NULL,
    "yandexBalanceBeforeMinor" BIGINT,
    "yandexBalanceAfterMinor" BIGINT,
    "yandexTransactionId" TEXT,
    "yandexIdempotencyToken" TEXT NOT NULL,
    "providerTransactionId" TEXT,
    "providerIdempotencyKey" TEXT NOT NULL,
    "providerStatusRaw" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "manualReviewReason" TEXT,
    "riskScore" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reservedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "slaDeadline" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "leaseOwner" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),

    CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawal_events" (
    "id" UUID NOT NULL,
    "withdrawalId" UUID NOT NULL,
    "fromState" "WithdrawalState",
    "toState" "WithdrawalState" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorType" TEXT NOT NULL DEFAULT 'SYSTEM',
    "actorId" TEXT,
    "note" TEXT,
    "metadata" JSONB,

    CONSTRAINT "withdrawal_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "responseCode" INTEGER,
    "responseBody" JSONB,
    "resultId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" UUID NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "key" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL,
    "type" "JournalEntryType" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "withdrawalId" UUID,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByAdminId" UUID,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_postings" (
    "id" UUID NOT NULL,
    "journalEntryId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "direction" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_postings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_events" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "withdrawalId" UUID,
    "signatureOk" BOOLEAN NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "processingError" TEXT,

    CONSTRAINT "provider_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_messages" (
    "id" UUID NOT NULL,
    "topic" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "processedAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "outbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_runs" (
    "id" UUID NOT NULL,
    "kind" "ReconciliationKind" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "scannedCount" INTEGER NOT NULL DEFAULT 0,
    "mismatchCount" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB,
    "triggeredBy" TEXT NOT NULL DEFAULT 'SCHEDULE',

    CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_mismatches" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "withdrawalId" UUID,
    "kind" TEXT NOT NULL,
    "expected" TEXT,
    "actual" TEXT,
    "detail" JSONB,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_mismatches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'VIEWER',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "mfaSecretEnc" TEXT,
    "mfaEnabledAt" TIMESTAMP(3),
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_sessions" (
    "id" UUID NOT NULL,
    "adminUserId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,
    "requestId" TEXT,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_health" (
    "id" UUID NOT NULL,
    "integration" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "lastOkAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastError" TEXT,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "okCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_health_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "devices_deviceId_idx" ON "devices"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "devices_userId_deviceId_key" ON "devices"("userId", "deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refreshTokenHash_key" ON "sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_revokedAt_idx" ON "sessions"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "sessions_familyId_idx" ON "sessions"("familyId");

-- CreateIndex
CREATE INDEX "otp_challenges_phone_createdAt_idx" ON "otp_challenges"("phone", "createdAt");

-- CreateIndex
CREATE INDEX "otp_challenges_expiresAt_idx" ON "otp_challenges"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_userId_key" ON "drivers"("userId");

-- CreateIndex
CREATE INDEX "drivers_verificationStatus_idx" ON "drivers"("verificationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_parkId_yandexContractorProfileId_key" ON "drivers"("parkId", "yandexContractorProfileId");

-- CreateIndex
CREATE INDEX "balance_snapshots_driverId_fetchedAt_idx" ON "balance_snapshots"("driverId", "fetchedAt");

-- CreateIndex
CREATE INDEX "payout_methods_driverId_status_idx" ON "payout_methods"("driverId", "status");

-- CreateIndex
CREATE INDEX "payout_methods_fingerprint_idx" ON "payout_methods"("fingerprint");

-- CreateIndex
CREATE INDEX "fee_schedules_parkId_currency_effectiveFrom_idx" ON "fee_schedules"("parkId", "currency", "effectiveFrom");

-- CreateIndex
CREATE INDEX "limit_policies_parkId_currency_effectiveFrom_idx" ON "limit_policies"("parkId", "currency", "effectiveFrom");

-- CreateIndex
CREATE INDEX "quotes_driverId_createdAt_idx" ON "quotes"("driverId", "createdAt");

-- CreateIndex
CREATE INDEX "quotes_expiresAt_idx" ON "quotes"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_reference_key" ON "withdrawals"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_yandexIdempotencyToken_key" ON "withdrawals"("yandexIdempotencyToken");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_providerIdempotencyKey_key" ON "withdrawals"("providerIdempotencyKey");

-- CreateIndex
CREATE INDEX "withdrawals_driverId_createdAt_idx" ON "withdrawals"("driverId", "createdAt");

-- CreateIndex
CREATE INDEX "withdrawals_state_nextAttemptAt_idx" ON "withdrawals"("state", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "withdrawals_parkId_createdAt_idx" ON "withdrawals"("parkId", "createdAt");

-- CreateIndex
CREATE INDEX "withdrawals_slaDeadline_idx" ON "withdrawals"("slaDeadline");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_driverId_idempotencyKey_key" ON "withdrawals"("driverId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "withdrawal_events_withdrawalId_at_idx" ON "withdrawal_events"("withdrawalId", "at");

-- CreateIndex
CREATE INDEX "idempotency_records_expiresAt_idx" ON "idempotency_records"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_scope_ownerId_key_key" ON "idempotency_records"("scope", "ownerId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_type_key_currency_key" ON "ledger_accounts"("type", "key", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_idempotencyKey_key" ON "journal_entries"("idempotencyKey");

-- CreateIndex
CREATE INDEX "journal_entries_withdrawalId_idx" ON "journal_entries"("withdrawalId");

-- CreateIndex
CREATE INDEX "journal_entries_createdAt_idx" ON "journal_entries"("createdAt");

-- CreateIndex
CREATE INDEX "ledger_postings_accountId_createdAt_idx" ON "ledger_postings"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "ledger_postings_journalEntryId_idx" ON "ledger_postings"("journalEntryId");

-- CreateIndex
CREATE INDEX "provider_events_processedAt_idx" ON "provider_events"("processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "provider_events_provider_externalId_key" ON "provider_events"("provider", "externalId");

-- CreateIndex
CREATE INDEX "outbox_messages_processedAt_availableAt_idx" ON "outbox_messages"("processedAt", "availableAt");

-- CreateIndex
CREATE INDEX "reconciliation_runs_kind_startedAt_idx" ON "reconciliation_runs"("kind", "startedAt");

-- CreateIndex
CREATE INDEX "reconciliation_mismatches_runId_idx" ON "reconciliation_mismatches"("runId");

-- CreateIndex
CREATE INDEX "reconciliation_mismatches_resolvedAt_idx" ON "reconciliation_mismatches"("resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "admin_sessions_tokenHash_key" ON "admin_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "admin_sessions_adminUserId_revokedAt_idx" ON "admin_sessions"("adminUserId", "revokedAt");

-- CreateIndex
CREATE INDEX "audit_logs_subjectType_subjectId_at_idx" ON "audit_logs"("subjectType", "subjectId", "at");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_at_idx" ON "audit_logs"("actorId", "at");

-- CreateIndex
CREATE INDEX "audit_logs_at_idx" ON "audit_logs"("at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_health_integration_key" ON "integration_health"("integration");

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_deviceRowId_fkey" FOREIGN KEY ("deviceRowId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_snapshots" ADD CONSTRAINT "balance_snapshots_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_methods" ADD CONSTRAINT "payout_methods_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_payoutMethodId_fkey" FOREIGN KEY ("payoutMethodId") REFERENCES "payout_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_payoutMethodId_fkey" FOREIGN KEY ("payoutMethodId") REFERENCES "payout_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_events" ADD CONSTRAINT "withdrawal_events_withdrawalId_fkey" FOREIGN KEY ("withdrawalId") REFERENCES "withdrawals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_withdrawalId_fkey" FOREIGN KEY ("withdrawalId") REFERENCES "withdrawals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_postings_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_postings_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_events" ADD CONSTRAINT "provider_events_withdrawalId_fkey" FOREIGN KEY ("withdrawalId") REFERENCES "withdrawals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_mismatches" ADD CONSTRAINT "reconciliation_mismatches_runId_fkey" FOREIGN KEY ("runId") REFERENCES "reconciliation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
