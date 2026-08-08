-- Two query shapes on `ev_reservations` had no index behind them, and both
-- run against a table that grows with every hold anybody places.
--
-- `listMine` filters by user and sorts by recency — composite so the sort is
-- served by the index too, matching what `transactions` and `ev_sessions`
-- already do.
CREATE INDEX "ev_reservations_userId_createdAt_idx" ON "ev_reservations"("userId", "createdAt");

-- The expiry sweep asks for confirmed holds past their window once a minute,
-- forever. Unindexed it reads every reservation ever made, every minute.
CREATE INDEX "ev_reservations_status_expiresAt_idx" ON "ev_reservations"("status", "expiresAt");
