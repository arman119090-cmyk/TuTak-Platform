-- Metrics group payments from the last hour by status on every scrape, and
-- the plan for that was a sequential scan of the entire table. Harmless at
-- the current size and progressively worse: at a million rows a scrape every
-- fifteen seconds makes monitoring the heaviest recurring load on the
-- database. Added now, while the table is small enough for the index build to
-- be instantaneous.
CREATE INDEX "payments_status_createdAt_idx" ON "payments"("status", "createdAt");
