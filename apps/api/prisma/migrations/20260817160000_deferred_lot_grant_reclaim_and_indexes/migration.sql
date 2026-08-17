-- Second-pass independent audit against the `forfeitedAmount` fix itself
-- (GitHub issue #28): `reverseUnlock` computed "spent" as
-- originalAmount - actual, which double-counts any value a *prior* partial
-- `reverseForRefund` (this lot's own purchase being partially refunded
-- while the grant was still live) had already reclaimed and accounted for.
-- `liveGrantReclaimedAmount` tracks that per-grant-episode so `reverseUnlock`
-- can subtract it out and isolate genuine customer spend.
ALTER TABLE "deferred_bonus_lots" ADD COLUMN "liveGrantReclaimedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE "deferred_bonus_lots"
  ADD CONSTRAINT "deferred_bonus_lots_live_grant_reclaimed_sane" CHECK (
    "liveGrantReclaimedAmount" >= 0 AND "liveGrantReclaimedAmount" <= "amount"
  );

-- Independent audit, GitHub issue #28: refunds look up BonusLot and
-- DeferredBonusLot by sourceTransactionId, and reverseSettlement looks up
-- BonusLedgerEntry by relatedReservationId, inside open transactions on the
-- hottest financial write paths. None of the three had a covering index —
-- full table scans under row locks, growing worse as these append-only
-- tables accumulate history that is never pruned.
CREATE INDEX "deferred_bonus_lots_sourceTransactionId_idx" ON "deferred_bonus_lots"("sourceTransactionId");
CREATE INDEX "bonus_lots_sourceTransactionId_idx" ON "bonus_lots"("sourceTransactionId");
CREATE INDEX "bonus_ledger_entries_relatedReservationId_idx" ON "bonus_ledger_entries"("relatedReservationId");

-- Independent audit, GitHub issue #28: a hard `user.delete()` would have
-- silently cascaded through Wallet and wiped the append-only bonus ledger of
-- record. No code path issues a hard delete today (account deletion is
-- anonymization), so this closes a landmine rather than fixing a live bug.
ALTER TABLE "wallets" DROP CONSTRAINT "wallets_userId_fkey";
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
