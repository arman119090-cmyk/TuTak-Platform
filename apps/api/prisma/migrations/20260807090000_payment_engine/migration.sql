-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CAPTURED', 'DECLINED');

-- DropForeignKey
ALTER TABLE "ledger_postings" DROP CONSTRAINT "ledger_postings_accountId_fkey";

-- DropForeignKey
ALTER TABLE "ledger_postings" DROP CONSTRAINT "ledger_postings_transactionId_fkey";

-- DropForeignKey
ALTER TABLE "ledger_transactions" DROP CONSTRAINT "ledger_transactions_reversesId_fkey";

-- AlterTable
ALTER TABLE "partners" ADD COLUMN     "paymentCommissionRateBps" INTEGER NOT NULL DEFAULT 250;

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'AMD',
    "commissionAmount" DECIMAL(18,4) NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "pspReference" TEXT,
    "declineReason" TEXT,
    "ledgerTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_ledgerTransactionId_key" ON "payments"("ledgerTransactionId");

-- CreateIndex
CREATE INDEX "payments_userId_idx" ON "payments"("userId");

-- CreateIndex
CREATE INDEX "payments_partnerId_idx" ON "payments"("partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_type_userId_partnerId_currency_key" ON "ledger_accounts"("type", "userId", "partnerId", "currency");

-- CreateIndex
CREATE INDEX "outbox_events_processedAt_nextAttemptAt_idx" ON "outbox_events"("processedAt", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_postings_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "ledger_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_postings_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_ledgerTransactionId_fkey" FOREIGN KEY ("ledgerTransactionId") REFERENCES "ledger_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "idempotency_records_scope_key" RENAME TO "idempotency_records_scope_key_key";

-- RenameIndex
ALTER INDEX "ledger_postings_accountId_idx" RENAME TO "ledger_postings_accountId_id_idx";

-- RenameIndex
ALTER INDEX "ledger_transactions_source_idx" RENAME TO "ledger_transactions_sourceType_sourceId_idx";

