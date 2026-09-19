-- CreateTable
CREATE TABLE "partner_settlement_transfer_attempts" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'AMD',
    "bankTransferReference" TEXT,
    "succeeded" BOOLEAN NOT NULL DEFAULT false,
    "failureReason" TEXT,
    "successKey" TEXT,
    "attemptedByUserId" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "partner_settlement_transfer_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "partner_settlement_transfer_attempts_settlementId_attempted_idx" ON "partner_settlement_transfer_attempts"("settlementId", "attemptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "partner_settlement_transfer_attempts_settlementId_successKe_key" ON "partner_settlement_transfer_attempts"("settlementId", "successKey");

-- CreateIndex
CREATE UNIQUE INDEX "partner_settlement_transfer_attempts_currency_bankTransferR_key" ON "partner_settlement_transfer_attempts"("currency", "bankTransferReference");

-- AddForeignKey
ALTER TABLE "partner_settlement_transfer_attempts" ADD CONSTRAINT "partner_settlement_transfer_attempts_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "partner_settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ────────────────────────────────────────────────────────────────────────
-- A bounced transfer must not strand what is owed.
--
-- Before this migration, FAILED was terminal: the settlement kept its
-- claimed `partner_settlement_entries` for ever and nothing could pay them,
-- so a partner whose bank transfer bounced could never be paid for those
-- sales at all. The fix is to separate the two things that were conflated:
--
--   * the settlement is the *statement of what is owed* — approved once,
--     frozen, and still owed after a bank refuses to move it;
--   * a transfer attempt is one try at moving it, and there may be several.
--
-- So FAILED is now a waiting state, not an ending, and every try is its own
-- row here. REQUIRES_RECONCILIATION is the third outcome — the bank's answer
-- was ambiguous, the money may or may not have left — and it is never
-- retried automatically, because an automatic retry on an ambiguous result
-- is exactly how a partner gets paid twice.
-- ────────────────────────────────────────────────────────────────────────

-- An attempt moves a real amount or it is not an attempt.
ALTER TABLE "partner_settlement_transfer_attempts"
  ADD CONSTRAINT "partner_settlement_transfer_attempts_amount_positive"
  CHECK ("amount" > 0);

-- A success must name the bank reference that proves it, be resolved, and
-- carry the key the partial index below uses. A failure must carry none of
-- that key, so the index can hold "at most one success per settlement".
ALTER TABLE "partner_settlement_transfer_attempts"
  ADD CONSTRAINT "partner_settlement_transfer_attempts_success_has_evidence"
  CHECK (
    CASE WHEN "succeeded"
      THEN "bankTransferReference" IS NOT NULL
           AND "resolvedAt" IS NOT NULL
           AND "successKey" IS NOT NULL
      ELSE "successKey" IS NULL
    END
  );

-- ── A successful attempt is history ─────────────────────────────────────
--
-- The same rule the settlement row itself has. Once an attempt records that
-- the money left, nothing may rewrite or delete it — not a later retry, not
-- a console session, not a migration.
CREATE OR REPLACE FUNCTION "partner_settlement_transfer_success_is_immutable"()
RETURNS trigger AS $$
BEGIN
  IF OLD."succeeded" THEN
    RAISE EXCEPTION
      'partner_settlement_transfer_attempts: attempt % succeeded and cannot be changed or deleted', OLD."id"
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "partner_settlement_transfer_attempts_success_immutable"
  BEFORE UPDATE OR DELETE ON "partner_settlement_transfer_attempts"
  FOR EACH ROW EXECUTE FUNCTION "partner_settlement_transfer_success_is_immutable"();

-- ── An attempt pays its own settlement's figure ─────────────────────────
--
-- Not a nicety: the attempt row is the audit trail a bank dispute is argued
-- from, and an attempt recording a different amount from the settlement it
-- closes would make that trail worthless. Currency likewise.
CREATE OR REPLACE FUNCTION "partner_settlement_transfer_matches_settlement"()
RETURNS trigger AS $$
DECLARE
  expected_amount numeric;
  expected_currency "Currency";
BEGIN
  SELECT "netPayableAmount", "currency" INTO expected_amount, expected_currency
    FROM "partner_settlements" WHERE "id" = NEW."settlementId";
  IF expected_amount IS DISTINCT FROM NEW."amount"
     OR expected_currency IS DISTINCT FROM NEW."currency" THEN
    RAISE EXCEPTION
      'partner_settlement_transfer_attempts: attempt for % % does not match settlement % (% %)',
      NEW."amount", NEW."currency", NEW."settlementId", expected_amount, expected_currency
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "partner_settlement_transfer_attempts_match_settlement"
  BEFORE INSERT OR UPDATE ON "partner_settlement_transfer_attempts"
  FOR EACH ROW EXECUTE FUNCTION "partner_settlement_transfer_matches_settlement"();

-- ── The settlement's own rules, widened for the new states ──────────────

-- FAILED and REQUIRES_RECONCILIATION are only reachable after approval, so
-- they too must be able to name the checker who approved the figure.
ALTER TABLE "partner_settlements"
  DROP CONSTRAINT "partner_settlements_approved_has_actor";

ALTER TABLE "partner_settlements"
  ADD CONSTRAINT "partner_settlements_approved_has_actor"
  CHECK (
    "status" NOT IN ('APPROVED', 'PAYMENT_PENDING', 'PAID', 'FAILED', 'REQUIRES_RECONCILIATION')
    OR ("approvedByUserId" IS NOT NULL AND "approvedAt" IS NOT NULL)
  );

-- A settlement that says a transfer failed must say why, and one that says
-- the bank's answer was ambiguous must say what was ambiguous. Both are read
-- by a human deciding whether to retry; neither is optional.
ALTER TABLE "partner_settlements"
  ADD CONSTRAINT "partner_settlements_failure_has_reason"
  CHECK (
    "status" NOT IN ('FAILED', 'REQUIRES_RECONCILIATION')
    OR "failedReason" IS NOT NULL
  );

-- The entries of a settlement past approval were already frozen; FAILED and
-- REQUIRES_RECONCILIATION are past approval too. Without this, the retry
-- path would be able to change what a partner was already told they are
-- owed, which is the bug the freeze exists to prevent.
CREATE OR REPLACE FUNCTION "partner_settlement_entries_frozen_after_approval"()
RETURNS trigger AS $$
DECLARE
  target_id text;
  target_status "PartnerSettlementStatus";
BEGIN
  target_id := COALESCE(NEW."settlementId", OLD."settlementId");
  SELECT "status" INTO target_status FROM "partner_settlements" WHERE "id" = target_id;
  IF target_status IN ('APPROVED', 'PAYMENT_PENDING', 'PAID', 'FAILED', 'REQUIRES_RECONCILIATION') THEN
    RAISE EXCEPTION
      'partner_settlement_entries: settlement % is %, its entries are frozen', target_id, target_status
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
