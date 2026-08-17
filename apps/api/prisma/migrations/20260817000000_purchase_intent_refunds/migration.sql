-- Replaces the PSP-style refund concept for ordinary TuTak purchases with a
-- transaction-linked TuTak refund: a partner enters only the merchandise
-- refund amount, TuTak never refunds real money (the partner repays the
-- customer outside TuTak), and every loyalty effect the original purchase
-- created is reversed proportionally. Deliberately not built on
-- `refunds`/`payments` — see `PurchaseIntentRefundService`.

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PURCHASE_INTENT_REFUNDED';

-- AlterTable
ALTER TABLE "purchase_intents" ADD COLUMN "refundedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "purchase_intent_refunds" (
    "id" TEXT NOT NULL,
    "purchaseIntentId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "bonusRestored" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "ledgerTransactionId" TEXT,
    "actorId" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_intent_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_intent_refunds_ledgerTransactionId_key" ON "purchase_intent_refunds"("ledgerTransactionId");

-- CreateIndex
CREATE INDEX "purchase_intent_refunds_purchaseIntentId_idx" ON "purchase_intent_refunds"("purchaseIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_intent_refunds_actorId_idempotencyKey_key" ON "purchase_intent_refunds"("actorId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "purchase_intent_refunds" ADD CONSTRAINT "purchase_intent_refunds_purchaseIntentId_fkey" FOREIGN KEY ("purchaseIntentId") REFERENCES "purchase_intents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_intent_refunds" ADD CONSTRAINT "purchase_intent_refunds_ledgerTransactionId_fkey" FOREIGN KEY ("ledgerTransactionId") REFERENCES "ledger_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The guard that stops a purchase being refunded past its own merchandise
-- value is a conditional UPDATE on this column, not a read-then-write in
-- application code — two concurrent refunds must not each read the same
-- stale total. Mirrors "payments_refunded_within_captured".
ALTER TABLE "purchase_intents"
  ADD CONSTRAINT "purchase_intents_refunded_within_gross" CHECK (
    "refundedAmount" >= 0 AND "refundedAmount" <= "grossAmount"
  );
