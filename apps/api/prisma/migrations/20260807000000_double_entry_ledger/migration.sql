-- Double-entry ledger, phase 1 of docs/FINANCIAL_CORE_DESIGN.md.
--
-- Additive only: no existing table is touched and no code writes to these
-- yet. The constraints go in first deliberately — nothing above this layer is
-- worth trusting until a posting cannot fail to balance.

CREATE TYPE "LedgerAccountType" AS ENUM (
  'CUSTOMER_PAYABLE', 'PARTNER_PAYABLE', 'PSP_RECEIVABLE',
  'PLATFORM_REVENUE', 'BONUS_LIABILITY'
);
CREATE TYPE "PostingDirection" AS ENUM ('DEBIT', 'CREDIT');

CREATE TABLE "ledger_accounts" (
  "id"        TEXT NOT NULL,
  "type"      "LedgerAccountType" NOT NULL,
  "userId"    TEXT,
  "partnerId" TEXT,
  "currency"  "Currency" NOT NULL DEFAULT 'AMD',
  "balance"   DECIMAL(18,4) NOT NULL DEFAULT 0,
  "version"   INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- Postgres treats NULLs as distinct in a unique index, so the plain compound
-- unique would let duplicate platform accounts through. Three partial indexes
-- cover the three shapes an account can legitimately take.
CREATE UNIQUE INDEX "ledger_accounts_customer_key"
  ON "ledger_accounts"("type", "userId", "currency")
  WHERE "userId" IS NOT NULL;
CREATE UNIQUE INDEX "ledger_accounts_partner_key"
  ON "ledger_accounts"("type", "partnerId", "currency")
  WHERE "partnerId" IS NOT NULL;
CREATE UNIQUE INDEX "ledger_accounts_platform_key"
  ON "ledger_accounts"("type", "currency")
  WHERE "userId" IS NULL AND "partnerId" IS NULL;

CREATE INDEX "ledger_accounts_partnerId_idx" ON "ledger_accounts"("partnerId");
CREATE INDEX "ledger_accounts_userId_idx" ON "ledger_accounts"("userId");

-- An account belongs to a customer, or to a partner, or to the platform —
-- never to both. A posting router given an ambiguous account has no correct
-- behaviour, so the state is made unrepresentable.
ALTER TABLE "ledger_accounts"
  ADD CONSTRAINT "ledger_accounts_single_owner" CHECK (
    NOT ("userId" IS NOT NULL AND "partnerId" IS NOT NULL)
  );

CREATE TABLE "ledger_transactions" (
  "id"         TEXT NOT NULL,
  "kind"       TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId"   TEXT NOT NULL,
  "reversesId" TEXT,
  "postedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ledger_transactions_reversesId_key"
  ON "ledger_transactions"("reversesId");
CREATE INDEX "ledger_transactions_source_idx"
  ON "ledger_transactions"("sourceType", "sourceId");
CREATE INDEX "ledger_transactions_postedAt_idx" ON "ledger_transactions"("postedAt");

-- One reversal per transaction, enforced by the unique index above: a second
-- attempt to reverse the same transaction collides rather than double-crediting.
ALTER TABLE "ledger_transactions"
  ADD CONSTRAINT "ledger_transactions_reversesId_fkey"
  FOREIGN KEY ("reversesId") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT;

CREATE TABLE "ledger_postings" (
  "id"            TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "accountId"     TEXT NOT NULL,
  "direction"     "PostingDirection" NOT NULL,
  "amount"        DECIMAL(18,4) NOT NULL,
  "currency"      "Currency" NOT NULL DEFAULT 'AMD',
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ledger_postings_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ledger_postings_accountId_idx" ON "ledger_postings"("accountId", "id");
CREATE INDEX "ledger_postings_transactionId_idx" ON "ledger_postings"("transactionId");

ALTER TABLE "ledger_postings"
  ADD CONSTRAINT "ledger_postings_transactionId_fkey"
  FOREIGN KEY ("transactionId") REFERENCES "ledger_transactions"("id") ON DELETE CASCADE;
ALTER TABLE "ledger_postings"
  ADD CONSTRAINT "ledger_postings_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT;

-- The sign lives in `direction`. A signed amount would give every value two
-- representations and make the balance check ambiguous.
ALTER TABLE "ledger_postings"
  ADD CONSTRAINT "ledger_postings_amount_positive" CHECK ("amount" > 0);

-- ── The balance rule ─────────────────────────────────────────────────────
--
-- Debits must equal credits for every transaction. This cannot be a row
-- CHECK: postings are inserted one at a time and an intermediate state is
-- legitimately unbalanced. A DEFERRABLE constraint trigger runs at COMMIT,
-- when the transaction is complete and the rule genuinely applies.
--
-- This is the single most important constraint in the financial core. Every
-- error double-entry exists to catch — a fee credited but never debited, a
-- partner paid from nowhere — arrives here as a non-zero imbalance.
CREATE OR REPLACE FUNCTION assert_ledger_transaction_balances() RETURNS TRIGGER AS $$
DECLARE
  imbalance NUMERIC;
  currencies INTEGER;
BEGIN
  SELECT
    COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE -amount END), 0),
    COUNT(DISTINCT currency)
  INTO imbalance, currencies
  FROM "ledger_postings"
  WHERE "transactionId" = NEW."transactionId";

  -- Mixed currencies cannot balance in any meaningful sense; until an
  -- explicit FX posting type exists, they are a bug.
  IF currencies > 1 THEN
    RAISE EXCEPTION 'Ledger transaction % mixes currencies', NEW."transactionId"
      USING ERRCODE = 'check_violation';
  END IF;

  IF imbalance <> 0 THEN
    RAISE EXCEPTION 'Ledger transaction % does not balance: debits - credits = %',
      NEW."transactionId", imbalance
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "ledger_postings_must_balance"
  AFTER INSERT ON "ledger_postings"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION assert_ledger_transaction_balances();

-- ── Immutability ─────────────────────────────────────────────────────────
--
-- A correction is a reversing transaction, never an edit. REVOKE is not
-- enough on its own because the application role owns these tables, so the
-- rule is enforced by a trigger that no grant can bypass.
CREATE OR REPLACE FUNCTION reject_ledger_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'ledger_postings is append-only; post a reversing transaction instead'
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ledger_postings_immutable"
  BEFORE UPDATE OR DELETE ON "ledger_postings"
  FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

-- ── Outbox ───────────────────────────────────────────────────────────────

CREATE TABLE "outbox_events" (
  "id"            TEXT NOT NULL,
  "aggregateType" TEXT NOT NULL,
  "aggregateId"   TEXT NOT NULL,
  "eventType"     TEXT NOT NULL,
  "payload"       JSONB NOT NULL,
  "processedAt"   TIMESTAMP(3),
  "attempts"      INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError"     TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);
-- Partial: the drainer only ever queries unprocessed rows, and the index
-- should not grow with the archive.
CREATE INDEX "outbox_events_pending_idx"
  ON "outbox_events"("nextAttemptAt") WHERE "processedAt" IS NULL;

ALTER TABLE "outbox_events"
  ADD CONSTRAINT "outbox_events_attempts_non_negative" CHECK ("attempts" >= 0);

-- ── Idempotency ──────────────────────────────────────────────────────────

CREATE TABLE "idempotency_records" (
  "id"           TEXT NOT NULL,
  "scope"        TEXT NOT NULL,
  "key"          TEXT NOT NULL,
  "requestHash"  TEXT NOT NULL,
  "status"       TEXT NOT NULL,
  "responseBody" JSONB,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"  TIMESTAMP(3),
  CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);
-- Scoped per actor: a global key let one account replay another's, which is a
-- mistake this codebase has already made once on Transaction.idempotencyKey.
CREATE UNIQUE INDEX "idempotency_records_scope_key" ON "idempotency_records"("scope", "key");

ALTER TABLE "idempotency_records"
  ADD CONSTRAINT "idempotency_records_status_known"
  CHECK ("status" IN ('IN_FLIGHT', 'COMPLETED'));
