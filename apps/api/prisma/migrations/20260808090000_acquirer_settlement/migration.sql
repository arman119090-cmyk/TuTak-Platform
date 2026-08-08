-- The inbound half of the platform's cash cycle.
--
-- Capture credits PSP_RECEIVABLE, which is a claim on the acquirer rather
-- than cash, and payouts spend PLATFORM_BANK. Nothing joined the two, so
-- one grew without bound while the other only ever went down and neither
-- could be compared against a real bank statement. This table records the
-- acquirer actually paying, and the posting that moves it.
--
-- `reference` is unique because the failure mode here is two operators
-- entering the same remittance advice from the same email.

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'ACQUIRER_SETTLEMENT_RECORDED';
-- CreateTable
CREATE TABLE "acquirer_settlements" (
    "id" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'AMD',
    "reference" TEXT NOT NULL,
    "settledOn" TIMESTAMP(3) NOT NULL,
    "ledgerTransactionId" TEXT,
    "recordedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "acquirer_settlements_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "acquirer_settlements_reference_key" ON "acquirer_settlements"("reference");
-- CreateIndex
CREATE UNIQUE INDEX "acquirer_settlements_ledgerTransactionId_key" ON "acquirer_settlements"("ledgerTransactionId");
-- CreateIndex
CREATE INDEX "acquirer_settlements_settledOn_idx" ON "acquirer_settlements"("settledOn");
-- AddForeignKey
ALTER TABLE "acquirer_settlements" ADD CONSTRAINT "acquirer_settlements_ledgerTransactionId_fkey" FOREIGN KEY ("ledgerTransactionId") REFERENCES "ledger_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
