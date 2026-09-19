-- CreateEnum
CREATE TYPE "PspResolutionBasis" AS ENUM ('PROVIDER_CALLBACK', 'PROVIDER_STATUS_QUERY', 'MANUAL_RECONCILIATION');

-- AlterTable
ALTER TABLE "psp_payment_attempts" ADD COLUMN     "escalatedAt" TIMESTAMP(3),
ADD COLUMN     "escalationCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reconciledByUserId" TEXT,
ADD COLUMN     "reconciliationCheckedByUserId" TEXT,
ADD COLUMN     "reconciliationEvidence" TEXT,
ADD COLUMN     "resolutionBasis" "PspResolutionBasis";


-- ────────────────────────────────────────────────────────────────────────
-- Time never releases a purchase.
--
-- Arman's decision of 15.09.2026, stated as a never: a timeout is not a
-- provider saying no. `EXPIRED` means nobody knows, and `FAILED` means the
-- provider stated authoritatively that no money moved — the one status that
-- lets another route collect. Letting a clock write the second from the first
-- is how a customer is charged twice with every log line looking reasonable.
--
-- The guarantee lives here rather than in a sweep's source because a sweep is
-- one caller. A console session, a data fix, a future job nobody re-read —
-- all of them reach this table, and none of them can get past a trigger.
--
-- Safe release has exactly two bases, and waiting is neither:
--
--   * the provider answered — its callback, or its status API where one
--     exists (Idram's adapter declares `statusQuery: false`, so today that
--     leaves only the callback);
--   * two people read the provider's statement and agreed. The same
--     maker/checker rule a settlement's reconciliation has, and for the same
--     reason: one person deciding alone that no money moved is one person
--     deciding alone to charge a customer twice.
-- ────────────────────────────────────────────────────────────────────────

-- A resolved-as-failed attempt must say on what basis. Without this the
-- column is decorative and any writer can skip it.
ALTER TABLE "psp_payment_attempts"
  ADD CONSTRAINT "psp_attempts_failure_is_authoritative"
  CHECK ("status" <> 'FAILED' OR "resolutionBasis" IS NOT NULL);

-- A manual resolution needs two different people and their evidence.
ALTER TABLE "psp_payment_attempts"
  ADD CONSTRAINT "psp_attempts_manual_resolution_needs_two_people"
  CHECK (
    "resolutionBasis" IS DISTINCT FROM 'MANUAL_RECONCILIATION'
    OR (
      "reconciledByUserId" IS NOT NULL
      AND "reconciliationCheckedByUserId" IS NOT NULL
      AND "reconciledByUserId" <> "reconciliationCheckedByUserId"
      AND "reconciliationEvidence" IS NOT NULL
      AND length(btrim("reconciliationEvidence")) > 0
    )
  );

-- Escalation counts up and never down: a count that can be reset is a count
-- that hides how long something has been unresolved.
ALTER TABLE "psp_payment_attempts"
  ADD CONSTRAINT "psp_attempts_escalation_count_non_negative"
  CHECK ("escalationCount" >= 0);

-- ── The transition rule itself ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION "psp_attempt_timeout_never_resolves"()
RETURNS trigger AS $$
BEGIN
  IF NEW."status" = 'FAILED' AND OLD."status" IS DISTINCT FROM 'FAILED' THEN
    -- Coming from a state where the provider was still being waited on, an
    -- authoritative answer is enough. Coming from EXPIRED or
    -- REQUIRES_RECONCILIATION, the money's fate was already unknown and only
    -- a human reconciliation or a direct provider answer may settle it —
    -- which is the same list, and the point is that *nothing else* may.
    IF NEW."resolutionBasis" IS NULL THEN
      RAISE EXCEPTION
        'psp_payment_attempts: attempt % cannot be failed without an authoritative basis; a timeout is not a provider saying no',
        NEW."id"
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  -- Escalation may never be the thing that changes a status. If a writer
  -- touches both in one statement, the status change is what it wanted and
  -- the escalation is a side effect it should not be having.
  IF NEW."status" IS DISTINCT FROM OLD."status"
     AND NEW."escalationCount" IS DISTINCT FROM OLD."escalationCount" THEN
    RAISE EXCEPTION
      'psp_payment_attempts: attempt % cannot change status and escalate in one write', NEW."id"
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "psp_attempts_timeout_never_resolves"
  BEFORE UPDATE ON "psp_payment_attempts"
  FOR EACH ROW EXECUTE FUNCTION "psp_attempt_timeout_never_resolves"();
