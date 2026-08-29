-- Customer prepaid balance — the collection mechanism
-- docs/ROAMING_CPO_FINANCIAL_ACCOUNTING_2026-08-29.md named as future work,
-- and docs/ROAMING_CPO_PREPAID_BALANCE_2026-08-29.md's own design. A
-- customer tops up a stored-value balance through a bank/PSP adapter, and
-- `EvCdrReconciliationService.completeAppInitiatedSession` spends it
-- automatically the moment a roaming session settles, instead of leaving
-- `EV_ROAMING_RECEIVABLE` as a permanent, uncollectible promise.
--
-- Purely additive: one new `LedgerAccountType` value, one new
-- `BalanceTopUpStatus` enum, one new `balance_top_ups` table. No existing
-- row is touched.

-- CreateEnum
ALTER TYPE "LedgerAccountType" ADD VALUE 'CUSTOMER_PREPAID_BALANCE';

-- CreateEnum
CREATE TYPE "BalanceTopUpStatus" AS ENUM ('PENDING', 'COMPLETED', 'DECLINED', 'FAILED');

-- CreateTable
CREATE TABLE "balance_top_ups" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'AMD',
    "status" "BalanceTopUpStatus" NOT NULL DEFAULT 'PENDING',
    "providerReference" TEXT,
    "declineReason" TEXT,
    "ledgerTransactionId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "balance_top_ups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "balance_top_ups_providerReference_key" ON "balance_top_ups"("providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "balance_top_ups_ledgerTransactionId_key" ON "balance_top_ups"("ledgerTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "balance_top_ups_userId_idempotencyKey_key" ON "balance_top_ups"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "balance_top_ups_userId_idx" ON "balance_top_ups"("userId");

-- CreateIndex
CREATE INDEX "balance_top_ups_status_createdAt_idx" ON "balance_top_ups"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "balance_top_ups" ADD CONSTRAINT "balance_top_ups_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_top_ups" ADD CONSTRAINT "balance_top_ups_ledgerTransactionId_fkey" FOREIGN KEY ("ledgerTransactionId") REFERENCES "ledger_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
