-- Account deletion, in two stages.
--
-- `deletedAt` already existed and already ended access — every auth path
-- checks it. What was missing is the second stage: the point at which the
-- personal fields are actually scrubbed. The two cannot be the same instant,
-- because a refund or a chargeback can still arrive against a payment made
-- before the deletion and has to post against a wallet whose owner row still
-- exists, and because a customer who deleted by mistake needs a window in
-- which support can restore them.
--
-- The row is never removed. Ledger postings, payments and audit entries
-- reference it by foreign key, and deleting a user would either break those
-- references or take the financial record with them.
ALTER TABLE "users" ADD COLUMN "anonymizedAt" TIMESTAMP(3);

-- The sweep asks for "deleted, not yet scrubbed" — a vanishing fraction of
-- the table, which would otherwise be a full scan every hour.
CREATE INDEX "users_deletedAt_anonymizedAt_idx" ON "users"("deletedAt", "anonymizedAt");

-- Both stages are audited. After the second one the audit entry and the user
-- id are all that is left of the person: enough to answer "did we delete
-- them, and when", which is exactly the question a regulator asks, and
-- nothing more than that.
ALTER TYPE "AuditAction" ADD VALUE 'ACCOUNT_DELETION_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE 'ACCOUNT_ANONYMIZED';
