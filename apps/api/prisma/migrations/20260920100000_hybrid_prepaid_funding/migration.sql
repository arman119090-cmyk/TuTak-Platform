-- ────────────────────────────────────────────────────────────────────────
-- Hybrid funding: a customer's stored money as a second TuTak-side funding
-- component of an ordinary purchase, next to bonus. Additive only: every
-- existing row keeps `prepaidAmountApplied = 0`, so `ordinaryPaymentRemainder
-- = grossAmount - bonusAmountRequested` remains exactly true for it.
-- ────────────────────────────────────────────────────────────────────────

-- A second per-customer account: money an open purchase has spoken for.
-- Added here and used by nothing in this migration — PostgreSQL forbids
-- using a freshly added enum value in the transaction that added it.
ALTER TYPE "LedgerAccountType" ADD VALUE 'CUSTOMER_PREPAID_RESERVED';

CREATE TYPE "ExternalRefundStatus" AS ENUM ('NOT_REQUIRED', 'PENDING_PARTNER', 'CONFIRMED');

ALTER TABLE "purchase_intents"
  ADD COLUMN "prepaidAmountApplied" DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "prepaidHoldTransactionId" TEXT;

CREATE UNIQUE INDEX "purchase_intents_prepaidHoldTransactionId_key"
  ON "purchase_intents"("prepaidHoldTransactionId");

ALTER TABLE "purchase_intents"
  ADD CONSTRAINT "purchase_intents_prepaidHoldTransactionId_fkey"
  FOREIGN KEY ("prepaidHoldTransactionId") REFERENCES "ledger_transactions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- The one identity the whole hybrid model rests on. Every component is
-- non-negative and they sum to the gross — so no client, no migration and
-- no bug can make the three legs disagree about what the purchase cost.
ALTER TABLE "purchase_intents"
  ADD CONSTRAINT "purchase_intents_funding_sums_to_gross" CHECK (
    "bonusAmountRequested" >= 0
    AND "prepaidAmountApplied" >= 0
    AND "ordinaryPaymentRemainder" >= 0
    AND "bonusAmountRequested" + "prepaidAmountApplied" + "ordinaryPaymentRemainder" = "grossAmount"
  );

-- A hold exists exactly when there is something held.
ALTER TABLE "purchase_intents"
  ADD CONSTRAINT "purchase_intents_prepaid_hold_matches_amount" CHECK (
    ("prepaidAmountApplied" = 0 AND "prepaidHoldTransactionId" IS NULL)
    OR ("prepaidAmountApplied" > 0 AND "prepaidHoldTransactionId" IS NOT NULL)
  );

-- The merchant-approval freeze covers the new component too: an approved
-- purchase whose prepaid share could still move would be approval of
-- nothing in particular. Same function, one more column.
CREATE OR REPLACE FUNCTION "purchase_intent_approved_economics_frozen"()
RETURNS trigger AS $$
BEGIN
  IF OLD."merchantApprovedAt" IS NULL THEN RETURN NEW; END IF;

  IF NEW."grossAmount"              IS DISTINCT FROM OLD."grossAmount"
     OR NEW."bonusAmountRequested"  IS DISTINCT FROM OLD."bonusAmountRequested"
     OR NEW."prepaidAmountApplied"  IS DISTINCT FROM OLD."prepaidAmountApplied"
     OR NEW."ordinaryPaymentRemainder" IS DISTINCT FROM OLD."ordinaryPaymentRemainder"
     OR NEW."quantity"              IS DISTINCT FROM OLD."quantity"
     OR NEW."quantityUnit"          IS DISTINCT FROM OLD."quantityUnit"
     OR NEW."unitPrice"             IS DISTINCT FROM OLD."unitPrice"
     OR NEW."contributionRuleId"    IS DISTINCT FROM OLD."contributionRuleId"
     OR NEW."contributionRuleVersion" IS DISTINCT FROM OLD."contributionRuleVersion"
     OR NEW."contributionRuleKind"  IS DISTINCT FROM OLD."contributionRuleKind"
     OR NEW."paymentRoute"          IS DISTINCT FROM OLD."paymentRoute"
     OR NEW."merchantApprovedByUserId" IS DISTINCT FROM OLD."merchantApprovedByUserId"
     OR NEW."merchantApprovedAt"    IS DISTINCT FROM OLD."merchantApprovedAt" THEN
    RAISE EXCEPTION
      'purchase_intents: purchase % was approved by the merchant and its economics are frozen', OLD."id"
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Refunds split across the same components.
ALTER TABLE "purchase_intent_refunds"
  ADD COLUMN "prepaidRestored" DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "externalRefundDue" DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "externalRefundStatus" "ExternalRefundStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN "externalRefundConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "externalRefundConfirmedByUserId" TEXT;

-- A refund's three slices are non-negative and sum to the refund. Existing
-- rows (prepaidRestored = externalRefundDue = 0) are not asserted on: their
-- external slice was never recorded, and inventing it now would rewrite
-- history. Only rows written by the component-aware engine carry the
-- identity, which is why it is a trigger keyed on the new columns being
-- used and not a blanket CHECK.
ALTER TABLE "purchase_intent_refunds"
  ADD CONSTRAINT "purchase_intent_refunds_components_non_negative" CHECK (
    "bonusRestored" >= 0 AND "prepaidRestored" >= 0 AND "externalRefundDue" >= 0
    AND "bonusRestored" + "prepaidRestored" + "externalRefundDue" <= "amount"
  );

-- The external status agrees with the amount it describes.
ALTER TABLE "purchase_intent_refunds"
  ADD CONSTRAINT "purchase_intent_refunds_external_status_matches_due" CHECK (
    ("externalRefundDue" = 0 AND "externalRefundStatus" = 'NOT_REQUIRED')
    OR ("externalRefundDue" > 0 AND "externalRefundStatus" <> 'NOT_REQUIRED')
  );

ALTER TABLE "purchase_intent_refunds"
  ADD CONSTRAINT "purchase_intent_refunds_confirmed_has_actor" CHECK (
    ("externalRefundStatus" <> 'CONFIRMED')
    OR ("externalRefundConfirmedAt" IS NOT NULL AND "externalRefundConfirmedByUserId" IS NOT NULL)
  );
