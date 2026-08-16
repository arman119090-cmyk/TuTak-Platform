-- Launch-readiness audit finding (unchanged since docs/HARDENING_AUDIT_2026-08-16.md
-- §K, MEDIUM): every other money-bucket table in this schema
-- (transactions, wallets, bonus_lots, bonus_reservations,
-- bonus_reservation_allocations, bonus_ledger_entries, ev_sessions,
-- ev_cdrs — see 20260806150000_harden_money_invariants) has a sanity CHECK
-- making a negative or otherwise nonsensical amount unrepresentable in the
-- database, as the last line of defence if application-level guards are
-- ever bypassed. `deferred_bonus_lots` and `referral_challenge_participants`
-- were added later (core-business-architecture migration) and never got
-- the same treatment.
--
-- Deliberately NOT a `progress <= required` upper bound, unlike
-- `bonus_lots_amounts_sane`'s `remainingAmount <= originalAmount`: a lot's
-- `remainingAmount` only ever decreases from its cap, but `progressTurnover`/
-- `progressAmount` are incremented by a whole purchase's gross amount in one
-- shot (`DeferredBonusLotService.advanceExistingLots`,
-- `ReferralService`'s Challenge-progress update) and routinely overshoot
-- the threshold in the very same write that crosses it, one statement
-- before the status flips away from DEFERRED/IN_PROGRESS — a real purchase
-- exceeding what was left on a lot, not a bug. An upper-bound CHECK here
-- would reject that ordinary case and break confirmation of a real
-- purchase.
ALTER TABLE "deferred_bonus_lots"
  DROP CONSTRAINT IF EXISTS "deferred_bonus_lots_amounts_sane",
  ADD CONSTRAINT "deferred_bonus_lots_amounts_sane" CHECK (
    "amount" > 0
    AND "requiredTurnover" > 0
    AND "progressTurnover" >= 0
  );

ALTER TABLE "referral_challenge_participants"
  DROP CONSTRAINT IF EXISTS "referral_challenge_participants_amounts_sane",
  ADD CONSTRAINT "referral_challenge_participants_amounts_sane" CHECK (
    "requiredAmount" > 0
    AND "progressAmount" >= 0
  );
