-- CreateEnum
CREATE TYPE "ContributionRuleKind" AS ENUM ('PERCENT_BPS', 'FIXED_PER_UNIT', 'HYBRID');

-- AlterTable
ALTER TABLE "purchase_intents" ADD COLUMN     "contributionRuleId" TEXT,
ADD COLUMN     "contributionRuleKind" "ContributionRuleKind",
ADD COLUMN     "contributionRuleVersion" INTEGER;

-- CreateTable
CREATE TABLE "partner_contribution_rules" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" "ContributionRuleKind" NOT NULL,
    "percentBps" INTEGER,
    "fixedPerUnit" DECIMAL(18,4),
    "unit" TEXT,
    "currency" "Currency" NOT NULL DEFAULT 'AMD',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveUntil" TIMESTAMP(3),
    "liveKey" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "partner_contribution_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "partner_contribution_rules_partnerId_effectiveFrom_idx" ON "partner_contribution_rules"("partnerId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "partner_contribution_rules_partnerId_version_key" ON "partner_contribution_rules"("partnerId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "partner_contribution_rules_partnerId_liveKey_key" ON "partner_contribution_rules"("partnerId", "liveKey");

-- AddForeignKey
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_contributionRuleId_fkey" FOREIGN KEY ("contributionRuleId") REFERENCES "partner_contribution_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_contribution_rules" ADD CONSTRAINT "partner_contribution_rules_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ────────────────────────────────────────────────────────────────────────
-- Versioned commercial terms.
--
-- Arman's decision of 15.09.2026: HAZE's 10 AMD per litre is neither rounded
-- to a percentage nor accommodated by loosening the global basis-point grid.
-- It gets its own shape. Existing percentage partners are not touched — their
-- purchases carry no rule snapshot and keep being priced from
-- `negotiatedRateBps`, exactly as before.
--
-- Everything below is the part Prisma cannot say: that a rule's numbers match
-- its kind, that terms are never rewritten after money has been priced under
-- them, and that a purchase's snapshot agrees with the rule it names.
-- ────────────────────────────────────────────────────────────────────────

-- A rule carries the numbers its kind needs and no others. A FIXED_PER_UNIT
-- row with a percentage in it is a row two readers would price differently.
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

-- Terms cost money; nonsense terms cost more. A percentage above 100 % or a
-- negative per-unit margin is not a configuration choice, it is a typo.
ALTER TABLE "partner_contribution_rules"
  ADD CONSTRAINT "partner_contribution_rules_amounts_sane"
  CHECK (
    ("percentBps" IS NULL OR ("percentBps" >= 0 AND "percentBps" <= 10000))
    AND ("fixedPerUnit" IS NULL OR "fixedPerUnit" >= 0)
    AND ("unit" IS NULL OR length(btrim("unit")) > 0)
  );

ALTER TABLE "partner_contribution_rules"
  ADD CONSTRAINT "partner_contribution_rules_version_positive"
  CHECK ("version" >= 1);

ALTER TABLE "partner_contribution_rules"
  ADD CONSTRAINT "partner_contribution_rules_window_is_ordered"
  CHECK ("effectiveUntil" IS NULL OR "effectiveUntil" > "effectiveFrom");

-- `liveKey` is what makes `(partnerId, liveKey)` mean "one live rule per
-- partner". It is set exactly while the window is open, so the two can never
-- disagree about which rule is in force.
ALTER TABLE "partner_contribution_rules"
  ADD CONSTRAINT "partner_contribution_rules_live_key_tracks_window"
  CHECK (
    CASE WHEN "effectiveUntil" IS NULL THEN "liveKey" IS NOT NULL ELSE "liveKey" IS NULL END
  );

-- ── Terms are never rewritten ───────────────────────────────────────────
--
-- The whole reason these are rows rather than columns on `partners`. Editing
-- a rate in place is what makes "what did we charge for that sale in March"
-- unanswerable; a contract change opens the next version instead. Closing the
-- window is the one permitted change, because that is not a change to the
-- terms, it is the statement that they ended.
CREATE OR REPLACE FUNCTION "partner_contribution_rule_is_immutable"()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'partner_contribution_rules: rule % priced real purchases and cannot be deleted', OLD."id"
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."partnerId"      IS DISTINCT FROM OLD."partnerId"
     OR NEW."version"     IS DISTINCT FROM OLD."version"
     OR NEW."kind"        IS DISTINCT FROM OLD."kind"
     OR NEW."percentBps"  IS DISTINCT FROM OLD."percentBps"
     OR NEW."fixedPerUnit" IS DISTINCT FROM OLD."fixedPerUnit"
     OR NEW."unit"        IS DISTINCT FROM OLD."unit"
     OR NEW."currency"    IS DISTINCT FROM OLD."currency"
     OR NEW."effectiveFrom" IS DISTINCT FROM OLD."effectiveFrom" THEN
    RAISE EXCEPTION
      'partner_contribution_rules: rule % is immutable; open a new version instead', OLD."id"
      USING ERRCODE = 'restrict_violation';
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

CREATE TRIGGER "partner_contribution_rules_immutable"
  BEFORE UPDATE OR DELETE ON "partner_contribution_rules"
  FOR EACH ROW EXECUTE FUNCTION "partner_contribution_rule_is_immutable"();

-- ── A purchase's snapshot agrees with the rule it names ─────────────────
--
-- The version and kind are copied onto the purchase so a receipt reads
-- without a join. Copies drift; this is what stops them. Note it fires only
-- when a rule is named — a percentage purchase with no rule is untouched.
CREATE OR REPLACE FUNCTION "purchase_intent_rule_snapshot_matches"()
RETURNS trigger AS $$
DECLARE
  rule_partner text;
  rule_version integer;
  rule_kind "ContributionRuleKind";
BEGIN
  IF NEW."contributionRuleId" IS NULL THEN
    IF NEW."contributionRuleVersion" IS NOT NULL OR NEW."contributionRuleKind" IS NOT NULL THEN
      RAISE EXCEPTION
        'purchase_intents: purchase % describes commercial terms it does not name', NEW."id"
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;

  SELECT "partnerId", "version", "kind"
    INTO rule_partner, rule_version, rule_kind
    FROM "partner_contribution_rules" WHERE "id" = NEW."contributionRuleId";

  IF rule_partner IS DISTINCT FROM NEW."partnerId" THEN
    RAISE EXCEPTION
      'purchase_intents: purchase % at partner % cannot be priced by partner %''s terms',
      NEW."id", NEW."partnerId", rule_partner
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF rule_version IS DISTINCT FROM NEW."contributionRuleVersion"
     OR rule_kind IS DISTINCT FROM NEW."contributionRuleKind" THEN
    RAISE EXCEPTION
      'purchase_intents: purchase % snapshot (v%, %) disagrees with rule % (v%, %)',
      NEW."id", NEW."contributionRuleVersion", NEW."contributionRuleKind",
      NEW."contributionRuleId", rule_version, rule_kind
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- A per-unit rule needs something to multiply. A purchase priced by one
  -- with no quantity is an invoice that cannot be derived, and the unit has
  -- to be the same unit — 10 AMD per litre against kilograms is not a
  -- rounding problem.
  IF rule_kind IN ('FIXED_PER_UNIT', 'HYBRID') THEN
    IF NEW."quantity" IS NULL THEN
      RAISE EXCEPTION
        'purchase_intents: purchase % is priced per unit but records no quantity', NEW."id"
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW."quantityUnit" IS DISTINCT FROM (
      SELECT "unit" FROM "partner_contribution_rules" WHERE "id" = NEW."contributionRuleId"
    ) THEN
      RAISE EXCEPTION
        'purchase_intents: purchase % is measured in % but its terms are per %',
        NEW."id", NEW."quantityUnit",
        (SELECT "unit" FROM "partner_contribution_rules" WHERE "id" = NEW."contributionRuleId")
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "purchase_intents_rule_snapshot_matches"
  BEFORE INSERT OR UPDATE ON "purchase_intents"
  FOR EACH ROW EXECUTE FUNCTION "purchase_intent_rule_snapshot_matches"();
