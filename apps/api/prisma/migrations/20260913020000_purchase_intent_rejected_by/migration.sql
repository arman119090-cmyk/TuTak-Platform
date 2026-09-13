-- Who turned the customer away.
--
-- `confirmedByUserId` claimed in its own comment to hold "whoever confirmed
-- or rejected", and `reject()` never wrote it: for every rejected purchase
-- the row did not say who made that decision. The actor was recorded in
-- `audit_logs` and nowhere else, which is the wrong place for a question an
-- owner asks about their own till.
--
-- A separate column rather than reusing `confirmedByUserId`: a field named
-- "confirmed by" holding the person who refused misleads whoever reads a
-- report instead of the schema comment.
--
-- Null on every row rejected before this existed. Backfilling from the audit
-- log is possible in principle and deliberately not done: those rows would
-- then be indistinguishable from ones recorded properly, and the audit log
-- is the honest source for them.
ALTER TABLE "purchase_intents" ADD COLUMN "rejectedByUserId" TEXT;

ALTER TABLE "purchase_intents"
  ADD CONSTRAINT "purchase_intents_rejectedByUserId_fkey"
  FOREIGN KEY ("rejectedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
