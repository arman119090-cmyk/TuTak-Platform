-- A partner's own till may approve the economics of a purchase it opened
-- (brief §20): the amount is partner-originated, stated under the partner's
-- M2M credential. The approval then names the key, not a person. The
-- constraint keeps its meaning — an approval always says who — and gains
-- the second kind of "who".
ALTER TABLE "purchase_intents" ADD COLUMN "merchantApprovedByApiKeyId" TEXT;

ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_merchantApprovedByApiKeyId_fkey"
  FOREIGN KEY ("merchantApprovedByApiKeyId") REFERENCES "partner_api_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_intents" DROP CONSTRAINT "purchase_intents_merchant_approval_is_complete";
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_merchant_approval_is_complete"
  CHECK (
    ("merchantApprovedAt" IS NULL AND "merchantApprovedByUserId" IS NULL AND "merchantApprovedByApiKeyId" IS NULL)
    OR ("merchantApprovedAt" IS NOT NULL AND "merchantApprovedByUserId" IS NOT NULL AND "merchantApprovedByApiKeyId" IS NULL)
    OR ("merchantApprovedAt" IS NOT NULL AND "merchantApprovedByUserId" IS NULL AND "merchantApprovedByApiKeyId" IS NOT NULL)
  );

-- The freeze covers the new column as well: once approved, who approved
-- does not change either.
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
     OR NEW."merchantApprovedByApiKeyId" IS DISTINCT FROM OLD."merchantApprovedByApiKeyId"
     OR NEW."merchantApprovedAt"    IS DISTINCT FROM OLD."merchantApprovedAt" THEN
    RAISE EXCEPTION
      'purchase_intents: purchase % was approved by the merchant and its economics are frozen', OLD."id"
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
