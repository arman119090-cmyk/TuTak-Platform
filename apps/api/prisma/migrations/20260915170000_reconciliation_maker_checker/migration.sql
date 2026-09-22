-- CreateEnum
CREATE TYPE "ReconciliationSource" AS ENUM ('FINANCE', 'PARTNER_REPORT');

-- CreateEnum
CREATE TYPE "ReconciliationOutcome" AS ENUM ('MONEY_MOVED', 'MONEY_DID_NOT_MOVE');

-- AlterTable
ALTER TABLE "partner_settlements" ADD COLUMN     "reconciliationConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "reconciliationConfirmedByUserId" TEXT,
ADD COLUMN     "reconciliationEvidence" TEXT,
ADD COLUMN     "reconciliationOutcome" "ReconciliationOutcome",
ADD COLUMN     "reconciliationProposedAt" TIMESTAMP(3),
ADD COLUMN     "reconciliationProposedByUserId" TEXT,
ADD COLUMN     "reconciliationReportedAt" TIMESTAMP(3),
ADD COLUMN     "reconciliationReportedByUserId" TEXT,
ADD COLUMN     "reconciliationSource" "ReconciliationSource";


-- ────────────────────────────────────────────────────────────────────────
-- Resolving an ambiguous transfer takes evidence and two different people.
--
-- The product decision of 15.09.2026. The reasoning is that "did the money move"
-- has two wrong answers with very different costs — guessing it moved leaves
-- a partner unpaid against a ledger that says otherwise, guessing it did not
-- pays them twice — and neither is a judgement one person should make alone
-- from a screen. It is the same maker/checker rule the settlement's own
-- approval already has, applied to the other decision that moves money.
--
-- A partner may raise the doubt (`PARTNER_REPORT`) and may not settle it.
-- Reporting that money never arrived is information; deciding whether it
-- moved is authority over the payout, and the partner is the payee.
-- ────────────────────────────────────────────────────────────────────────

-- A proposed answer must say what it rests on and who proposed it. Evidence
-- is free-form because a bank statement line, a reference and a support case
-- id are all legitimate; it is not optional, because "we think it went" with
-- nothing behind it is what this whole mechanism exists to prevent.
ALTER TABLE "partner_settlements"
  ADD CONSTRAINT "partner_settlements_reconciliation_proposal_is_complete"
  CHECK (
    ("reconciliationOutcome" IS NULL
      AND "reconciliationProposedByUserId" IS NULL
      AND "reconciliationProposedAt" IS NULL)
    OR ("reconciliationOutcome" IS NOT NULL
      AND "reconciliationProposedByUserId" IS NOT NULL
      AND "reconciliationProposedAt" IS NOT NULL
      AND "reconciliationEvidence" IS NOT NULL
      AND length(btrim("reconciliationEvidence")) > 0)
  );

-- A confirmation confirms something. Without this, a settlement could record
-- a checker with no proposal for them to have checked.
ALTER TABLE "partner_settlements"
  ADD CONSTRAINT "partner_settlements_reconciliation_confirms_a_proposal"
  CHECK (
    "reconciliationConfirmedByUserId" IS NULL
    OR ("reconciliationOutcome" IS NOT NULL
      AND "reconciliationProposedByUserId" IS NOT NULL
      AND "reconciliationConfirmedAt" IS NOT NULL)
  );

-- The checker is not the maker. This is the whole point, and it belongs in
-- the database and not only in a service method: a console session, a script
-- or a future code path nobody re-checked reaches this table too.
ALTER TABLE "partner_settlements"
  ADD CONSTRAINT "partner_settlements_reconciliation_needs_two_people"
  CHECK (
    "reconciliationConfirmedByUserId" IS NULL
    OR "reconciliationConfirmedByUserId" <> "reconciliationProposedByUserId"
  );

-- And neither of them is whoever reported the problem, when that was a
-- partner. A payee who can report a missing transfer and then confirm that it
-- never arrived is a payee who can order their own second payment.
ALTER TABLE "partner_settlements"
  ADD CONSTRAINT "partner_settlements_partner_reporter_does_not_resolve"
  CHECK (
    "reconciliationSource" IS DISTINCT FROM 'PARTNER_REPORT'
    OR "reconciliationReportedByUserId" IS NULL
    OR (
      "reconciliationProposedByUserId" IS DISTINCT FROM "reconciliationReportedByUserId"
      AND "reconciliationConfirmedByUserId" IS DISTINCT FROM "reconciliationReportedByUserId"
    )
  );

-- A settlement awaiting reconciliation says who raised it and when. Same
-- discipline as `approved_has_actor`: a state that exists because somebody
-- acted must be able to name them.
ALTER TABLE "partner_settlements"
  ADD CONSTRAINT "partner_settlements_reconciliation_has_source"
  CHECK (
    "status" <> 'REQUIRES_RECONCILIATION'
    OR ("reconciliationSource" IS NOT NULL AND "reconciliationReportedAt" IS NOT NULL)
  );
