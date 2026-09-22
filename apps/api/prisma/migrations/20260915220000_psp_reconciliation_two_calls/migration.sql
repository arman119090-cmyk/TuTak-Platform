-- AlterTable
ALTER TABLE "psp_payment_attempts" ADD COLUMN     "reconciliationProposedAt" TIMESTAMP(3);


-- ────────────────────────────────────────────────────────────────────────
-- Releasing a payment nobody can account for takes two people, in two calls.
--
-- It already took two *user ids*. That was not the same thing: one
-- authenticated caller passed both, so the second person existed only as a
-- string the first one typed. The product decision of 15.09.2026 is explicit —
-- one HTTP caller cannot supply the identity of the second human.
--
-- So the proposal is now persisted on its own, by an authenticated actor, and
-- changes nothing; a second authenticated actor confirms it. The constraints
-- below are what make that true of the table and not only of the service.
-- ────────────────────────────────────────────────────────────────────────

-- A proposal names its proposer and its evidence, and nothing else.
ALTER TABLE "psp_payment_attempts"
  ADD CONSTRAINT "psp_attempts_reconciliation_proposal_is_complete"
  CHECK (
    "reconciliationProposedAt" IS NULL
    OR ("reconciledByUserId" IS NOT NULL
        AND "reconciliationEvidence" IS NOT NULL
        AND length(btrim("reconciliationEvidence")) > 0)
  );

-- A proposal, on its own, resolves nothing. This is the constraint that
-- makes "propose changes no money" a property of the database: while the
-- proposal is outstanding the attempt may not already be FAILED by manual
-- reconciliation.
ALTER TABLE "psp_payment_attempts"
  ADD CONSTRAINT "psp_attempts_open_proposal_is_unresolved"
  CHECK (
    "reconciliationProposedAt" IS NULL
    OR "reconciliationCheckedByUserId" IS NOT NULL
    OR "status" <> 'FAILED'
  );

-- ── The confirmation may not be the proposal ────────────────────────────
--
-- Already checked by `psp_attempts_manual_resolution_needs_two_people`; what
-- this adds is that the confirmation cannot appear without a proposal having
-- been recorded first. Without it, both columns could still be written in one
-- statement — which is exactly the shape being removed.
ALTER TABLE "psp_payment_attempts"
  ADD CONSTRAINT "psp_attempts_confirmation_follows_a_proposal"
  CHECK (
    "reconciliationCheckedByUserId" IS NULL
    OR "reconciliationProposedAt" IS NOT NULL
  );
