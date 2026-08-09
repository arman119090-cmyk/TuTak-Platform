-- Reconciling a roaming session against the charge-point operator's own CDR.
--
-- Until now `fetchCdr` was declared on the OCPI adapter and called from
-- nowhere: a roaming session was billed entirely on a meter reading reported
-- to our API, with nothing external corroborating it. The CPO owns the
-- hardware and their settled CDR is the authoritative record of what was
-- delivered, so these columns are where the two are held side by side and the
-- disagreement between them is recorded.
--
-- Our own stations keep NOT_APPLICABLE: there is one meter and it is ours.
CREATE TYPE "EvCdrReconciliation" AS ENUM (
  'NOT_APPLICABLE',
  'PENDING',
  'MATCHED',
  'CORRECTED',
  'UNDERBILLED',
  'UNAVAILABLE'
);

ALTER TABLE "ev_cdrs"
  ADD COLUMN "reconciliation" "EvCdrReconciliation" NOT NULL DEFAULT 'NOT_APPLICABLE',
  -- The CPO's figures are kept beside ours rather than overwriting them. The
  -- difference is the thing worth being able to look at after a dispute.
  ADD COLUMN "cpoEnergyKwh" DECIMAL(10,3),
  ADD COLUMN "cpoCost" DECIMAL(18,4),
  ADD COLUMN "reconciledAt" TIMESTAMP(3),
  -- A CDR that never arrives has to stop being polled and start being
  -- somebody's problem.
  ADD COLUMN "fetchAttempts" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "ev_cdrs_reconciliation_createdAt_idx" ON "ev_cdrs"("reconciliation", "createdAt");
