-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('REQUESTED', 'PAID', 'FAILED');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('CLEAN', 'DRIFT_DETECTED');

-- AlterEnum
ALTER TYPE "FraudSignalType" ADD VALUE 'SETTLEMENT_DRIFT';

-- AlterEnum
ALTER TYPE "LedgerAccountType" ADD VALUE 'BANK_CLEARING';

-- AlterTable
ALTER TABLE "partners" ADD COLUMN     "payoutsBlockedAt" TIMESTAMP(3),
ADD COLUMN     "payoutsBlockedReason" TEXT;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "refundedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "settledAt" TIMESTAMP(3),
ADD COLUMN     "settlementId" TEXT;

-- CreateTable
CREATE TABLE "settlements" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "grossAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "commissionAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "bonusAccrued" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "paymentCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "reason" TEXT NOT NULL,
    "ledgerTransactionId" TEXT,
    "bonusClawedBack" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "status" "PayoutStatus" NOT NULL,
    "bankReference" TEXT,
    "failureReason" TEXT,
    "ledgerTransactionId" TEXT,
    "requestedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_runs" (
    "id" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "status" "ReconciliationStatus" NOT NULL,
    "findings" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "settlements_periodStart_idx" ON "settlements"("periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_partnerId_periodStart_key" ON "settlements"("partnerId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_ledgerTransactionId_key" ON "refunds"("ledgerTransactionId");

-- CreateIndex
CREATE INDEX "refunds_paymentId_idx" ON "refunds"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_ledgerTransactionId_key" ON "payouts"("ledgerTransactionId");

-- CreateIndex
CREATE INDEX "payouts_partnerId_status_idx" ON "payouts"("partnerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_runs_periodStart_key" ON "reconciliation_runs"("periodStart");

-- CreateIndex
CREATE INDEX "payments_settlementId_idx" ON "payments"("settlementId");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_ledgerTransactionId_fkey" FOREIGN KEY ("ledgerTransactionId") REFERENCES "ledger_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_ledgerTransactionId_fkey" FOREIGN KEY ("ledgerTransactionId") REFERENCES "ledger_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────
-- Money invariants for the new tables.
--
-- Same discipline as 20260806150000_harden_money_invariants: the guarantee
-- lives in the database, not in whichever code path happens to be calling.
-- Application checks protect the callers that go through them; a CHECK
-- constraint protects against the caller nobody has written yet.
-- ─────────────────────────────────────────────────────────────────────────

-- A refund of zero moves nothing and would still consume an idempotency key.
ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_amounts_sane" CHECK (
    "amount" > 0 AND "bonusClawedBack" >= 0
  );

ALTER TABLE "payouts"
  ADD CONSTRAINT "payouts_amount_positive" CHECK ("amount" > 0);

-- The one that matters most. Over-refunding is the classic way to drain a
-- payment processor, and the classic way it happens is two concurrent
-- refunds each reading the same stale total before either writes. The
-- application guards this with a conditional UPDATE; this constraint means
-- that even if that guard is removed or bypassed, the database refuses.
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_refunded_within_captured" CHECK (
    "refundedAmount" >= 0 AND "refundedAmount" <= "amount"
  );

ALTER TABLE "settlements"
  ADD CONSTRAINT "settlements_amounts_sane" CHECK (
    "grossAmount" >= 0
    AND "commissionAmount" >= 0
    AND "netAmount" >= 0
    AND "bonusAccrued" >= 0
    AND "paymentCount" >= 0
    AND "periodEnd" > "periodStart"
  );

-- The lot settlement issued for a payment. A direct link rather than a
-- metadata lookup, so a refund can find exactly the points this payment
-- created. Unique because one payment accrues at most one lot.
ALTER TABLE "payments" ADD COLUMN "accruedLotId" TEXT;
CREATE UNIQUE INDEX "payments_accruedLotId_key" ON "payments"("accruedLotId");
