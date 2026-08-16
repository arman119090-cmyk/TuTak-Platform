-- Launch-readiness audit finding (unchanged since docs/HARDENING_AUDIT_2026-08-16.md
-- §K, HIGH): the expiry-release sweep asks for confirmed active reservations
-- past their window once a minute, forever
-- (BonusEngineService's stale-reservation sweep,
-- `WHERE status = 'ACTIVE' AND expiresAt <= now`), and until now that read
-- every reservation ever made, every minute — the identical shape already
-- fixed for `ev_reservations` in 20260808220000_ev_reservation_indexes but
-- never backported here.
CREATE INDEX IF NOT EXISTS "bonus_reservations_status_expiresAt_idx"
  ON "bonus_reservations"("status", "expiresAt");
