-- Payout settlement gets its own posting.
--
-- BANK_CLEARING was holding a permanent balance equal to every payout ever
-- confirmed, because confirmation wrote no ledger entry at all. It was, in
-- effect, doing the platform bank account's job while claiming to report
-- money in flight. PLATFORM_BANK takes that job.

-- AlterEnum
ALTER TYPE "LedgerAccountType" ADD VALUE 'PLATFORM_BANK';
-- AlterTable
ALTER TABLE "payouts" ADD COLUMN     "settlementLedgerTransactionId" TEXT;
-- CreateIndex
CREATE UNIQUE INDEX "payouts_settlementLedgerTransactionId_key" ON "payouts"("settlementLedgerTransactionId");
-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_settlementLedgerTransactionId_fkey" FOREIGN KEY ("settlementLedgerTransactionId") REFERENCES "ledger_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
