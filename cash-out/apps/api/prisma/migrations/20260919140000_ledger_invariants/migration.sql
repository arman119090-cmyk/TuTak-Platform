-- Invariants that belong in the database, not only in application code.
--
-- Everything below exists because "the service always does X" stops being true
-- the moment someone adds a second service, a migration script, or a psql
-- session at 3am. These are the rules that survive all of that.

-- ---------------------------------------------------------------------------
-- 1. The ledger is append-only.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION cashout_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'Table % is append-only: % is not permitted. Post a compensating row instead.',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_entries_append_only
  BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION cashout_reject_mutation();

CREATE TRIGGER ledger_postings_append_only
  BEFORE UPDATE OR DELETE ON ledger_postings
  FOR EACH ROW EXECUTE FUNCTION cashout_reject_mutation();

CREATE TRIGGER withdrawal_events_append_only
  BEFORE UPDATE OR DELETE ON withdrawal_events
  FOR EACH ROW EXECUTE FUNCTION cashout_reject_mutation();

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION cashout_reject_mutation();

-- ---------------------------------------------------------------------------
-- 2. Every journal entry balances, per currency.
--
-- Deferred to commit time so that the postings of one entry may be inserted in
-- any order inside a transaction, but no transaction can commit a lopsided
-- entry.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION cashout_assert_entry_balances() RETURNS trigger AS $$
DECLARE
  offending RECORD;
BEGIN
  SELECT p.currency,
         SUM(CASE WHEN p.direction = 'DEBIT'  THEN p."amountMinor" ELSE 0 END) AS debits,
         SUM(CASE WHEN p.direction = 'CREDIT' THEN p."amountMinor" ELSE 0 END) AS credits
    INTO offending
    FROM ledger_postings p
   WHERE p."journalEntryId" = NEW."journalEntryId"
   GROUP BY p.currency
  HAVING SUM(CASE WHEN p.direction = 'DEBIT'  THEN p."amountMinor" ELSE 0 END)
       <> SUM(CASE WHEN p.direction = 'CREDIT' THEN p."amountMinor" ELSE 0 END)
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Journal entry % does not balance in %: debits % <> credits %',
      NEW."journalEntryId", offending.currency, offending.debits, offending.credits
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ledger_postings_balanced
  AFTER INSERT ON ledger_postings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION cashout_assert_entry_balances();

-- A posting's amount is a magnitude; the direction carries the sign.
ALTER TABLE ledger_postings
  ADD CONSTRAINT ledger_postings_amount_non_negative CHECK ("amountMinor" >= 0);

ALTER TABLE ledger_postings
  ADD CONSTRAINT ledger_postings_direction_valid CHECK (direction IN ('DEBIT', 'CREDIT'));

-- ---------------------------------------------------------------------------
-- 3. A withdrawal's own arithmetic can never be wrong in the database.
-- ---------------------------------------------------------------------------

ALTER TABLE withdrawals
  ADD CONSTRAINT withdrawals_amounts_balance
  CHECK ("grossMinor" = "platformFeeMinor" + "providerFeeMinor" + "netMinor");

ALTER TABLE withdrawals
  ADD CONSTRAINT withdrawals_amounts_non_negative
  CHECK ("grossMinor" > 0 AND "platformFeeMinor" >= 0 AND "providerFeeMinor" >= 0 AND "netMinor" > 0);

ALTER TABLE quotes
  ADD CONSTRAINT quotes_amounts_balance
  CHECK ("grossMinor" = "platformFeeMinor" + "providerFeeMinor" + "netMinor");

ALTER TABLE quotes
  ADD CONSTRAINT quotes_amounts_non_negative
  CHECK ("grossMinor" > 0 AND "platformFeeMinor" >= 0 AND "providerFeeMinor" >= 0 AND "netMinor" > 0);

-- ---------------------------------------------------------------------------
-- 4. One live withdrawal per driver.
--
-- The service checks this too, but two requests arriving in the same
-- millisecond on two app servers would both pass that check. This index is what
-- actually makes it true.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX withdrawals_one_live_per_driver
  ON withdrawals ("driverId")
  WHERE state NOT IN ('COMPLETED', 'REVERSED', 'FAILED', 'REJECTED');

-- One default payout method per driver, likewise.
CREATE UNIQUE INDEX payout_methods_one_default_per_driver
  ON payout_methods ("driverId")
  WHERE "isDefault" = true AND "disabledAt" IS NULL;

-- ---------------------------------------------------------------------------
-- 5. A quote can be spent once.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX quotes_consumed_once
  ON quotes ("consumedByWithdrawalId")
  WHERE "consumedByWithdrawalId" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. Fee schedules and limit policies may not overlap for the same scope.
--
-- An open-ended row (effectiveTo IS NULL) excludes any other open-ended row for
-- the same park and currency, so "which fee applies right now" always has
-- exactly one answer.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX fee_schedules_one_open_per_scope
  ON fee_schedules (COALESCE("parkId", '*'), currency)
  WHERE "effectiveTo" IS NULL;

CREATE UNIQUE INDEX limit_policies_one_open_per_scope
  ON limit_policies (COALESCE("parkId", '*'), currency)
  WHERE "effectiveTo" IS NULL;
