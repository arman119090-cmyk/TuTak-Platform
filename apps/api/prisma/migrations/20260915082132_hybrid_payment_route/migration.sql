-- CreateEnum
CREATE TYPE "PaymentRoute" AS ENUM ('DIRECT_PARTNER', 'TUTAK_PSP');

-- CreateEnum
CREATE TYPE "DirectTender" AS ENUM ('CASH', 'PARTNER_CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "PspAttemptStatus" AS ENUM ('INITIATED', 'PENDING_CONFIRMATION', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'REQUIRES_RECONCILIATION');

-- CreateEnum
CREATE TYPE "FeePayer" AS ENUM ('PLATFORM', 'PARTNER', 'SPLIT');

-- AlterTable
ALTER TABLE "purchase_intents" ADD COLUMN     "directTender" "DirectTender",
ADD COLUMN     "paymentRoute" "PaymentRoute" NOT NULL DEFAULT 'DIRECT_PARTNER',
ADD COLUMN     "quantity" DECIMAL(18,4),
ADD COLUMN     "quantityUnit" TEXT,
ADD COLUMN     "unitPrice" DECIMAL(18,4);

-- CreateTable
CREATE TABLE "psp_payment_attempts" (
    "id" TEXT NOT NULL,
    "purchaseIntentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "PspAttemptStatus" NOT NULL DEFAULT 'INITIATED',
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'AMD',
    "providerBillId" TEXT,
    "providerTransactionId" TEXT,
    "providerFeeAmount" DECIMAL(18,4),
    "feeRuleId" TEXT,
    "liveKey" TEXT,
    "ledgerTransactionId" TEXT,
    "failureReason" TEXT,
    "providerPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "psp_payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "psp_fee_rules" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "paymentMethod" TEXT,
    "percentBps" INTEGER NOT NULL DEFAULT 0,
    "fixedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" "Currency" NOT NULL DEFAULT 'AMD',
    "payer" "FeePayer" NOT NULL DEFAULT 'PLATFORM',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveUntil" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "psp_fee_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "psp_payment_attempts_ledgerTransactionId_key" ON "psp_payment_attempts"("ledgerTransactionId");

-- CreateIndex
CREATE INDEX "psp_payment_attempts_status_idx" ON "psp_payment_attempts"("status");

-- CreateIndex
CREATE INDEX "psp_payment_attempts_purchaseIntentId_idx" ON "psp_payment_attempts"("purchaseIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "psp_payment_attempts_purchaseIntentId_liveKey_key" ON "psp_payment_attempts"("purchaseIntentId", "liveKey");

-- CreateIndex
CREATE UNIQUE INDEX "psp_payment_attempts_provider_providerTransactionId_key" ON "psp_payment_attempts"("provider", "providerTransactionId");

-- CreateIndex
CREATE INDEX "psp_fee_rules_provider_effectiveFrom_idx" ON "psp_fee_rules"("provider", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "psp_payment_attempts" ADD CONSTRAINT "psp_payment_attempts_purchaseIntentId_fkey" FOREIGN KEY ("purchaseIntentId") REFERENCES "purchase_intents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "psp_payment_attempts" ADD CONSTRAINT "psp_payment_attempts_ledgerTransactionId_fkey" FOREIGN KEY ("ledgerTransactionId") REFERENCES "ledger_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "psp_payment_attempts" ADD CONSTRAINT "psp_payment_attempts_feeRuleId_fkey" FOREIGN KEY ("feeRuleId") REFERENCES "psp_fee_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ────────────────────────────────────────────────────────────────────────
-- One purchase, one money route — enforced by the database.
-- ────────────────────────────────────────────────────────────────────────

-- A DIRECT purchase never has a provider attempt, and a PSP purchase never
-- has a cashier's tender. Without this the two routes could both leave
-- traces on one purchase and nobody could say which one took the money.
ALTER TABLE "purchase_intents"
  ADD CONSTRAINT "purchase_intents_tender_matches_route"
  CHECK ("paymentRoute" <> 'TUTAK_PSP' OR "directTender" IS NULL);

-- Per-unit pricing is all-or-nothing. A quantity with no unit price is a
-- receipt that cannot be re-derived.
ALTER TABLE "purchase_intents"
  ADD CONSTRAINT "purchase_intents_quantity_is_complete"
  CHECK (
    ("quantity" IS NULL AND "quantityUnit" IS NULL AND "unitPrice" IS NULL)
    OR ("quantity" IS NOT NULL AND "quantityUnit" IS NOT NULL AND "unitPrice" IS NOT NULL)
  );

ALTER TABLE "purchase_intents"
  ADD CONSTRAINT "purchase_intents_quantity_positive"
  CHECK ("quantity" IS NULL OR ("quantity" > 0 AND "unitPrice" >= 0));

-- A provider attempt may only exist on a purchase routed through a provider.
CREATE OR REPLACE FUNCTION "psp_attempt_requires_psp_route"()
RETURNS trigger AS $$
DECLARE
  route "PaymentRoute";
BEGIN
  SELECT "paymentRoute" INTO route FROM "purchase_intents" WHERE "id" = NEW."purchaseIntentId";
  IF route <> 'TUTAK_PSP' THEN
    RAISE EXCEPTION
      'psp_payment_attempts: purchase % is routed %, not TUTAK_PSP', NEW."purchaseIntentId", route
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "psp_attempt_route_matches"
  BEFORE INSERT OR UPDATE ON "psp_payment_attempts"
  FOR EACH ROW EXECUTE FUNCTION "psp_attempt_requires_psp_route"();

-- `liveKey` is the mechanism, so it must be used the one way that works: set
-- while unresolved, null once terminal. Combined with the unique index on
-- (purchaseIntentId, liveKey) this is what allows exactly one live attempt.
ALTER TABLE "psp_payment_attempts"
  ADD CONSTRAINT "psp_attempts_live_key_tracks_status"
  CHECK (
    ("status" IN ('INITIATED', 'PENDING_CONFIRMATION') AND "liveKey" IS NOT NULL)
    OR ("status" NOT IN ('INITIATED', 'PENDING_CONFIRMATION') AND "liveKey" IS NULL)
  );

-- A succeeded attempt must name the provider transaction it succeeded with
-- and the ledger entry it produced. "Succeeded" with neither is a claim that
-- money moved with nothing to point at.
ALTER TABLE "psp_payment_attempts"
  ADD CONSTRAINT "psp_attempts_success_has_evidence"
  CHECK (
    "status" <> 'SUCCEEDED'
    OR ("providerTransactionId" IS NOT NULL AND "ledgerTransactionId" IS NOT NULL AND "confirmedAt" IS NOT NULL)
  );

ALTER TABLE "psp_payment_attempts"
  ADD CONSTRAINT "psp_attempts_amount_positive"
  CHECK ("amount" > 0);

-- A succeeded attempt is history. Reversal is a refund, never an edit.
CREATE OR REPLACE FUNCTION "psp_attempt_success_is_immutable"()
RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'SUCCEEDED' THEN
    RAISE EXCEPTION
      'psp_payment_attempts: attempt % succeeded and cannot be changed or deleted', OLD."id"
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "psp_attempts_success_immutable"
  BEFORE UPDATE OR DELETE ON "psp_payment_attempts"
  FOR EACH ROW EXECUTE FUNCTION "psp_attempt_success_is_immutable"();

-- A fee rule's window must be a window, and a rule is never edited in place
-- (a contract change closes one row and opens another), so past purchases
-- stay explainable by the rate that was actually in force.
ALTER TABLE "psp_fee_rules"
  ADD CONSTRAINT "psp_fee_rules_window_is_ordered"
  CHECK ("effectiveUntil" IS NULL OR "effectiveUntil" > "effectiveFrom");

ALTER TABLE "psp_fee_rules"
  ADD CONSTRAINT "psp_fee_rules_amounts_sane"
  CHECK ("percentBps" >= 0 AND "percentBps" <= 10000 AND "fixedAmount" >= 0);

CREATE OR REPLACE FUNCTION "psp_fee_rule_is_immutable"()
RETURNS trigger AS $$
BEGIN
  -- Closing a rule's window is the one permitted change; everything else
  -- would rewrite the rate a historical purchase was charged at.
  IF NEW."provider" IS DISTINCT FROM OLD."provider"
     OR NEW."paymentMethod" IS DISTINCT FROM OLD."paymentMethod"
     OR NEW."percentBps" IS DISTINCT FROM OLD."percentBps"
     OR NEW."fixedAmount" IS DISTINCT FROM OLD."fixedAmount"
     OR NEW."payer" IS DISTINCT FROM OLD."payer"
     OR NEW."effectiveFrom" IS DISTINCT FROM OLD."effectiveFrom" THEN
    RAISE EXCEPTION
      'psp_fee_rules: rule % is immutable — close it and open a new one instead', OLD."id"
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "psp_fee_rules_immutable"
  BEFORE UPDATE ON "psp_fee_rules"
  FOR EACH ROW EXECUTE FUNCTION "psp_fee_rule_is_immutable"();
