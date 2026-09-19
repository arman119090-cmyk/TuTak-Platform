-- ════════════════════════════════════════════════════════════════════════
-- Three of Arman's decisions of 15.09.2026, in one migration because they
-- touch the same two tables and splitting them would leave the schema in a
-- state neither version describes.
--
--  3. A provider confirms that money moved. It cannot confirm that a sale
--     happened. Somebody at the business approves the economics first.
--  4. Commercial terms change by maker/checker, not by whoever wrote last.
--  5. A unit of measure is an identifier, not a label. "L" and "л" are not
--     allowed to be different units.
-- ════════════════════════════════════════════════════════════════════════

CREATE TYPE "UnitOfMeasure" AS ENUM ('LITER', 'KWH', 'KILOGRAM', 'ITEM', 'HOUR');
CREATE TYPE "ContributionRuleStatus" AS ENUM ('PROPOSED', 'ACTIVE', 'SUPERSEDED', 'REJECTED');

-- ── 5. Units become a closed vocabulary ─────────────────────────────────
--
-- Converted in place with a USING clause rather than dropped and re-added:
-- `prisma migrate diff` generates the latter, which would throw away every
-- recorded unit. There should be none today, but a migration that destroys
-- financial data when it is wrong about that is not one worth writing.
--
-- The mapping accepts the spellings a free-text column actually collects —
-- case, Armenian, and the words — and anything outside it stops the
-- migration rather than being guessed at. A unit nobody anticipated is a
-- commercial question, not something to coerce into LITER.

CREATE FUNCTION "pg_temp_unit_of_measure"(raw text) RETURNS "UnitOfMeasure" AS $$
BEGIN
  IF raw IS NULL THEN RETURN NULL; END IF;
  CASE lower(btrim(raw))
    WHEN 'l' THEN RETURN 'LITER';
    WHEN 'л' THEN RETURN 'LITER';
    WHEN 'lt' THEN RETURN 'LITER';
    WHEN 'ltr' THEN RETURN 'LITER';
    WHEN 'litre' THEN RETURN 'LITER';
    WHEN 'liter' THEN RETURN 'LITER';
    WHEN 'литр' THEN RETURN 'LITER';
    WHEN 'kwh' THEN RETURN 'KWH';
    WHEN 'kw/h' THEN RETURN 'KWH';
    WHEN 'квтч' THEN RETURN 'KWH';
    WHEN 'кВт*ч' THEN RETURN 'KWH';
    WHEN 'kg' THEN RETURN 'KILOGRAM';
    WHEN 'кг' THEN RETURN 'KILOGRAM';
    WHEN 'kilogram' THEN RETURN 'KILOGRAM';
    WHEN 'item' THEN RETURN 'ITEM';
    WHEN 'pcs' THEN RETURN 'ITEM';
    WHEN 'шт' THEN RETURN 'ITEM';
    WHEN 'hour' THEN RETURN 'HOUR';
    WHEN 'h' THEN RETURN 'HOUR';
    WHEN 'ч' THEN RETURN 'HOUR';
    ELSE
      RAISE EXCEPTION
        'unit_of_measure: cannot convert % to a UnitOfMeasure. Decide what it means and extend this mapping; do not guess.', raw
        USING ERRCODE = 'data_exception';
  END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- These CHECKs and this trigger read the columns being retyped, so they come
-- off first and go back on below in their new form.
ALTER TABLE "partner_contribution_rules"
  DROP CONSTRAINT "partner_contribution_rules_shape_matches_kind",
  DROP CONSTRAINT "partner_contribution_rules_amounts_sane",
  DROP CONSTRAINT "partner_contribution_rules_live_key_tracks_window";
ALTER TABLE "purchase_intents"
  DROP CONSTRAINT "purchase_intents_quantity_is_complete";

ALTER TABLE "partner_contribution_rules"
  ALTER COLUMN "unit" TYPE "UnitOfMeasure" USING "pg_temp_unit_of_measure"("unit");
ALTER TABLE "purchase_intents"
  ALTER COLUMN "quantityUnit" TYPE "UnitOfMeasure" USING "pg_temp_unit_of_measure"("quantityUnit");

DROP FUNCTION "pg_temp_unit_of_measure"(text);

-- ── 4. Commercial terms: proposal, then approval ────────────────────────

ALTER TABLE "partner_contribution_rules"
  ADD COLUMN "status" "ContributionRuleStatus" NOT NULL DEFAULT 'PROPOSED',
  ADD COLUMN "proposedByUserId" TEXT,
  ADD COLUMN "approvedByUserId" TEXT,
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "rejectedByUserId" TEXT,
  ADD COLUMN "rejectedAt" TIMESTAMP(3),
  ADD COLUMN "decisionNote" TEXT,
  ALTER COLUMN "version" DROP NOT NULL;

-- Any rule that already exists was written before approval existed and is in
-- force; describing it as an unapproved proposal would be a lie about the
-- terms real purchases were priced under.
UPDATE "partner_contribution_rules"
   SET "status" = (CASE WHEN "liveKey" IS NOT NULL THEN 'ACTIVE' ELSE 'SUPERSEDED' END)::"ContributionRuleStatus",
       "proposedByUserId" = "createdByUserId",
       "approvedByUserId" = "createdByUserId",
       "approvedAt" = "createdAt";

CREATE INDEX "partner_contribution_rules_partnerId_status_idx"
  ON "partner_contribution_rules"("partnerId", "status");

-- The shape rules, restated over the typed unit.
ALTER TABLE "partner_contribution_rules"
  ADD CONSTRAINT "partner_contribution_rules_shape_matches_kind"
  CHECK (
    CASE "kind"
      WHEN 'PERCENT_BPS' THEN
        "percentBps" IS NOT NULL AND "fixedPerUnit" IS NULL AND "unit" IS NULL
      WHEN 'FIXED_PER_UNIT' THEN
        "percentBps" IS NULL AND "fixedPerUnit" IS NOT NULL AND "unit" IS NOT NULL
      WHEN 'HYBRID' THEN
        "percentBps" IS NOT NULL AND "fixedPerUnit" IS NOT NULL AND "unit" IS NOT NULL
    END
  );

-- The `length(btrim(unit)) > 0` clause is gone with the free text: an enum
-- cannot be blank, which is half the reason it is an enum.
ALTER TABLE "partner_contribution_rules"
  ADD CONSTRAINT "partner_contribution_rules_amounts_sane"
  CHECK (
    ("percentBps" IS NULL OR ("percentBps" >= 0 AND "percentBps" <= 10000))
    AND ("fixedPerUnit" IS NULL OR "fixedPerUnit" >= 0)
  );

-- `liveKey` now tracks the status rather than the window, so "one live rule
-- per partner" and "exactly one ACTIVE row" are the same statement.
ALTER TABLE "partner_contribution_rules"
  ADD CONSTRAINT "partner_contribution_rules_live_key_tracks_status"
  CHECK (
    CASE WHEN "status" = 'ACTIVE' THEN "liveKey" IS NOT NULL ELSE "liveKey" IS NULL END
  );

-- A proposal is not a version of anything: no number, no window, no claim to
-- be in force. This is what stops a losing concurrent write from quietly
-- becoming "the next version" — it never had a number to keep.
ALTER TABLE "partner_contribution_rules"
  ADD CONSTRAINT "partner_contribution_rules_proposal_is_inert"
  CHECK (
    "status" <> 'PROPOSED'
    OR ("version" IS NULL AND "effectiveUntil" IS NULL AND "approvedByUserId" IS NULL)
  );

-- Anything that ever priced money has a number and a checker.
ALTER TABLE "partner_contribution_rules"
  ADD CONSTRAINT "partner_contribution_rules_in_force_was_approved"
  CHECK (
    "status" NOT IN ('ACTIVE', 'SUPERSEDED')
    OR ("version" IS NOT NULL AND "approvedByUserId" IS NOT NULL AND "approvedAt" IS NOT NULL)
  );

-- Maker is not checker. The decision says so, and a service method is not
-- where a rule like this survives a console session.
ALTER TABLE "partner_contribution_rules"
  ADD CONSTRAINT "partner_contribution_rules_needs_two_people"
  CHECK (
    "approvedByUserId" IS NULL
    OR "proposedByUserId" IS NULL
    OR "approvedByUserId" <> "proposedByUserId"
  );

ALTER TABLE "partner_contribution_rules"
  ADD CONSTRAINT "partner_contribution_rules_rejection_is_complete"
  CHECK (
    CASE WHEN "status" = 'REJECTED'
      THEN "rejectedByUserId" IS NOT NULL AND "rejectedAt" IS NOT NULL
        AND ("proposedByUserId" IS NULL OR "rejectedByUserId" <> "proposedByUserId")
      ELSE "rejectedByUserId" IS NULL AND "rejectedAt" IS NULL
    END
  );

-- ── The immutability trigger, taught about approval ─────────────────────
--
-- Terms stay frozen. What changes is that a PROPOSED row is allowed exactly
-- one move — into ACTIVE or REJECTED — and an ACTIVE row exactly one, into
-- SUPERSEDED. Everything else, including any edit to the numbers, is still
-- refused outright.
CREATE OR REPLACE FUNCTION "partner_contribution_rule_is_immutable"()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" = 'PROPOSED' THEN
      -- A proposal nobody acted on priced nothing, so withdrawing it loses
      -- no history. Anything past that is a record of real money.
      RETURN OLD;
    END IF;
    RAISE EXCEPTION
      'partner_contribution_rules: rule % priced real purchases and cannot be deleted', OLD."id"
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW."partnerId"       IS DISTINCT FROM OLD."partnerId"
     OR NEW."kind"         IS DISTINCT FROM OLD."kind"
     OR NEW."percentBps"   IS DISTINCT FROM OLD."percentBps"
     OR NEW."fixedPerUnit" IS DISTINCT FROM OLD."fixedPerUnit"
     OR NEW."unit"         IS DISTINCT FROM OLD."unit"
     OR NEW."currency"     IS DISTINCT FROM OLD."currency"
     OR NEW."proposedByUserId" IS DISTINCT FROM OLD."proposedByUserId" THEN
    RAISE EXCEPTION
      'partner_contribution_rules: rule % is immutable; propose a new version instead', OLD."id"
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF NOT (
      (OLD."status" = 'PROPOSED' AND NEW."status" IN ('ACTIVE', 'REJECTED'))
      OR (OLD."status" = 'ACTIVE' AND NEW."status" = 'SUPERSEDED')
    ) THEN
      RAISE EXCEPTION
        'partner_contribution_rules: rule % cannot move from % to %', OLD."id", OLD."status", NEW."status"
        USING ERRCODE = 'restrict_violation';
    END IF;
  ELSE
    -- No status change means no approval either, so the version number and
    -- the start of the window are settled facts.
    IF NEW."version" IS DISTINCT FROM OLD."version"
       OR NEW."effectiveFrom" IS DISTINCT FROM OLD."effectiveFrom" THEN
      RAISE EXCEPTION
        'partner_contribution_rules: rule % is immutable; propose a new version instead', OLD."id"
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  IF OLD."effectiveUntil" IS NOT NULL
     AND NEW."effectiveUntil" IS DISTINCT FROM OLD."effectiveUntil" THEN
    RAISE EXCEPTION
      'partner_contribution_rules: rule % is already closed', OLD."id"
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 3. Merchant authorisation ───────────────────────────────────────────

ALTER TABLE "purchase_intents"
  ADD COLUMN "merchantApprovedByUserId" TEXT,
  ADD COLUMN "merchantApprovedAt" TIMESTAMP(3),
  ADD COLUMN "merchantApprovalNote" TEXT;

-- Every purchase already confirmed was confirmed by a cashier looking at it,
-- which is exactly what merchant approval means. Back-filled so the column
-- describes history truthfully rather than implying nobody ever checked.
UPDATE "purchase_intents"
   SET "merchantApprovedByUserId" = "confirmedByUserId",
       "merchantApprovedAt" = "confirmedAt"
 WHERE "status" = 'CONFIRMED' AND "confirmedAt" IS NOT NULL;

ALTER TABLE "purchase_intents"
  ADD CONSTRAINT "purchase_intents_merchant_approval_is_complete"
  CHECK (
    ("merchantApprovedAt" IS NULL AND "merchantApprovedByUserId" IS NULL)
    OR ("merchantApprovedAt" IS NOT NULL AND "merchantApprovedByUserId" IS NOT NULL)
  );

-- The quantity rule, restated over the typed unit.
ALTER TABLE "purchase_intents"
  ADD CONSTRAINT "purchase_intents_quantity_is_complete"
  CHECK (
    ("quantity" IS NULL AND "quantityUnit" IS NULL AND "unitPrice" IS NULL)
    OR ("quantity" IS NOT NULL AND "quantityUnit" IS NOT NULL AND "unitPrice" IS NOT NULL)
  );

-- ── The approved snapshot is frozen ─────────────────────────────────────
--
-- The whole value of merchant approval is that what was approved is what gets
-- paid for. A purchase whose gross could still move afterwards would be
-- approval of nothing in particular.
CREATE OR REPLACE FUNCTION "purchase_intent_approved_economics_frozen"()
RETURNS trigger AS $$
BEGIN
  IF OLD."merchantApprovedAt" IS NULL THEN RETURN NEW; END IF;

  IF NEW."grossAmount"              IS DISTINCT FROM OLD."grossAmount"
     OR NEW."bonusAmountRequested"  IS DISTINCT FROM OLD."bonusAmountRequested"
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

CREATE TRIGGER "purchase_intents_approved_economics_frozen"
  BEFORE UPDATE ON "purchase_intents"
  FOR EACH ROW EXECUTE FUNCTION "purchase_intent_approved_economics_frozen"();

-- ── No bill without approval ────────────────────────────────────────────
--
-- The rule the whole of decision 3 comes down to, and it lives here rather
-- than only in `beginAttempt` because the cost of getting it wrong is a
-- partner credited, cashback minted and referrers paid for a sale that never
-- took place.
CREATE OR REPLACE FUNCTION "psp_attempt_requires_psp_route"()
RETURNS trigger AS $$
DECLARE
  route "PaymentRoute";
  approved timestamp(3);
BEGIN
  SELECT "paymentRoute", "merchantApprovedAt" INTO route, approved
    FROM "purchase_intents" WHERE "id" = NEW."purchaseIntentId";
  IF route <> 'TUTAK_PSP' THEN
    RAISE EXCEPTION
      'psp_payment_attempts: purchase % is routed %, not TUTAK_PSP', NEW."purchaseIntentId", route
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF approved IS NULL THEN
    RAISE EXCEPTION
      'psp_payment_attempts: purchase % has not been approved by the merchant; a provider confirms payment, not that a sale happened',
      NEW."purchaseIntentId"
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
