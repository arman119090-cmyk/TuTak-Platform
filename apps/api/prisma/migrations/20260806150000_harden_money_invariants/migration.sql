-- Hardening migration: ledger becomes replayable, money invariants become
-- unrepresentable in the database.
--
-- Background: docs/AUDIT_2026-08.md §B1, §B2, §B3, §B5.
-- Enum values used here are added by the preceding migration.

-- ── Per-bucket deltas make the ledger the source of truth ────────────────
ALTER TABLE "bonus_ledger_entries"
  ADD COLUMN IF NOT EXISTS "availableDelta" DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "pendingDelta"   DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "reservedDelta"  DECIMAL(18,4) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "bonus_ledger_entries_sourceTransactionId_idx"
  ON "bonus_ledger_entries"("sourceTransactionId");

-- ── Idempotency keys are per-user, not global ────────────────────────────
-- A global key let one account replay another's key and receive that
-- account's transaction, and let an attacker squat a key so the victim's
-- later payment silently became a no-op.
DROP INDEX IF EXISTS "transactions_idempotencyKey_key";

-- Any historical duplicate would block the new index; keep the earliest.
DELETE FROM "transactions" a
USING "transactions" b
WHERE a."idempotencyKey" IS NOT NULL
  AND a."idempotencyKey" = b."idempotencyKey"
  AND a."userId" = b."userId"
  AND a."createdAt" > b."createdAt";

CREATE UNIQUE INDEX IF NOT EXISTS "transactions_userId_idempotencyKey_key"
  ON "transactions"("userId", "idempotencyKey");

-- ── Clean rows that the new constraints would reject ─────────────────────
-- Development databases contain transactions written while negative amounts
-- were accepted. Remove them and their ledger trail so the constraints can
-- be installed. (No production deployment has occurred.)
DELETE FROM "bonus_ledger_entries"
WHERE "sourceTransactionId" IN (
  SELECT id FROM "transactions"
  WHERE "bonusAppliedAmount" < 0 OR "bonusEarnedAmount" < 0 OR "amount" < 0
);
DELETE FROM "transactions"
WHERE "bonusAppliedAmount" < 0 OR "bonusEarnedAmount" < 0 OR "amount" < 0;

-- Ledger rows written while a negative admin DEBIT was accepted.
DELETE FROM "bonus_ledger_entries" WHERE "amount" < 0;

UPDATE "wallets" SET
  "availableBonus" = GREATEST("availableBonus", 0),
  "pendingBonus"   = GREATEST("pendingBonus", 0),
  "reservedBonus"  = GREATEST("reservedBonus", 0),
  "lifetimeEarned" = GREATEST("lifetimeEarned", 0),
  "lifetimeSpent"  = GREATEST("lifetimeSpent", 0);

-- ── Money invariants enforced by the database ────────────────────────────
-- Last line of defence: even if DTO validation and the domain guards are
-- both bypassed by a future code path, the state stays representable only
-- if it is arithmetically sane.

ALTER TABLE "transactions"
  DROP CONSTRAINT IF EXISTS "transactions_amounts_non_negative",
  ADD CONSTRAINT "transactions_amounts_non_negative" CHECK (
    "amount" >= 0 AND "bonusAppliedAmount" >= 0 AND "bonusEarnedAmount" >= 0
  );

ALTER TABLE "wallets"
  DROP CONSTRAINT IF EXISTS "wallets_balances_non_negative",
  ADD CONSTRAINT "wallets_balances_non_negative" CHECK (
    "availableBonus" >= 0 AND "pendingBonus" >= 0 AND "reservedBonus" >= 0
    AND "lifetimeEarned" >= 0 AND "lifetimeSpent" >= 0
  );

ALTER TABLE "bonus_lots"
  DROP CONSTRAINT IF EXISTS "bonus_lots_amounts_sane",
  ADD CONSTRAINT "bonus_lots_amounts_sane" CHECK (
    "originalAmount" > 0
    AND "remainingAmount" >= 0
    AND "remainingAmount" <= "originalAmount"
  );

ALTER TABLE "bonus_reservations"
  DROP CONSTRAINT IF EXISTS "bonus_reservations_amount_positive",
  ADD CONSTRAINT "bonus_reservations_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "bonus_reservation_allocations"
  DROP CONSTRAINT IF EXISTS "bonus_allocations_amount_positive",
  ADD CONSTRAINT "bonus_allocations_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "bonus_ledger_entries"
  DROP CONSTRAINT IF EXISTS "bonus_ledger_amount_non_negative",
  ADD CONSTRAINT "bonus_ledger_amount_non_negative" CHECK ("amount" >= 0);

-- The entry's deltas must agree with its stated direction.
--
-- Added NOT VALID on purpose. Rows written before this migration predate the
-- delta columns entirely: their deltas default to 0 while their amount is
-- non-zero, and the old semantics cannot be reconstructed reliably (that
-- inability is precisely the defect this migration fixes). NOT VALID enforces
-- the rule on every insert and update from now on while grandfathering the
-- historical rows, instead of silently deleting a ledger.
--
-- A database created from scratch — including every CI test database — has no
-- such rows, so the test suite runs VALIDATE CONSTRAINT to prove the rule
-- holds universally there.
ALTER TABLE "bonus_ledger_entries"
  DROP CONSTRAINT IF EXISTS "bonus_ledger_delta_matches_direction";
ALTER TABLE "bonus_ledger_entries"
  ADD CONSTRAINT "bonus_ledger_delta_matches_direction" CHECK (
    ("direction" = 'CREDIT'  AND "availableDelta" + "pendingDelta" + "reservedDelta" =  "amount") OR
    ("direction" = 'DEBIT'   AND "availableDelta" + "pendingDelta" + "reservedDelta" = -"amount") OR
    ("direction" = 'NEUTRAL' AND "availableDelta" + "pendingDelta" + "reservedDelta" =  0)
  ) NOT VALID;

ALTER TABLE "ev_sessions"
  DROP CONSTRAINT IF EXISTS "ev_sessions_amounts_non_negative",
  ADD CONSTRAINT "ev_sessions_amounts_non_negative" CHECK (
    ("energyKwh" IS NULL OR "energyKwh" >= 0)
    AND ("cost" IS NULL OR "cost" >= 0)
    AND ("bonusEarnedAmount" IS NULL OR "bonusEarnedAmount" >= 0)
  );

ALTER TABLE "ev_connectors"
  DROP CONSTRAINT IF EXISTS "ev_connectors_pricing_sane",
  ADD CONSTRAINT "ev_connectors_pricing_sane" CHECK (
    "powerKw" > 0 AND "pricePerKwh" >= 0
  );

ALTER TABLE "ev_cdrs"
  DROP CONSTRAINT IF EXISTS "ev_cdrs_totals_non_negative",
  ADD CONSTRAINT "ev_cdrs_totals_non_negative" CHECK (
    "totalEnergy" >= 0 AND "totalCost" >= 0 AND "totalTimeSec" >= 0
  );

ALTER TABLE "partners"
  DROP CONSTRAINT IF EXISTS "partners_accrual_rate_bounded",
  ADD CONSTRAINT "partners_accrual_rate_bounded" CHECK (
    "bonusAccrualRateBps" >= 0 AND "bonusAccrualRateBps" <= 10000
  );
