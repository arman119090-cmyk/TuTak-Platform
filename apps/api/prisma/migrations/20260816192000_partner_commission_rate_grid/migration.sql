-- Product decision: partner commission (`bonusAccrualRateBps`) is no longer
-- any basis-point value up to 100% — it is restricted to a fixed rate card,
-- 0.5% steps from 0.5% to 20% (50..2000 bps, step 50). Enforced already at
-- the DTO boundary (`IsCommissionRateBps`) and re-checked in
-- `PartnersService`; this constraint is the third, database layer of the
-- same rule, matching this codebase's established pattern (see
-- `is-money-string.validator.ts`) of making the invalid state
-- unrepresentable even if the application-layer checks are somehow skipped.
--
-- No pre-existing row needs cleaning: no partner in any environment today
-- carries an off-grid rate (every seeded/demo rate is already a multiple of
-- 50), so this is a pure additive constraint, not a data migration.
--
-- `partners_accrual_rate_bounded` (20260806150000_harden_money_invariants,
-- 0-10000) is superseded, not complemented, by this constraint — every value
-- this one accepts already satisfies that one, so keeping both would just be
-- two names for a rule that no longer means what the older name says.

ALTER TABLE "partners"
  DROP CONSTRAINT IF EXISTS "partners_accrual_rate_bounded",
  DROP CONSTRAINT IF EXISTS "partners_commission_rate_on_grid",
  ADD CONSTRAINT "partners_commission_rate_on_grid" CHECK (
    "bonusAccrualRateBps" >= 50
    AND "bonusAccrualRateBps" <= 2000
    AND "bonusAccrualRateBps" % 50 = 0
  );
