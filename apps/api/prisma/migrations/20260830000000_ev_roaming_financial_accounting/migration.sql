-- Frozen dual-rate financial accounting for an app-initiated `ROAMING_CPO`
-- charging session — docs/ROAMING_CPO_FINANCIAL_ACCOUNTING_2026-08-29.md.
-- Completes the remaining piece of
-- docs/ROAMING_CPO_INTEGRATION_2026-08-27-SECURITY.md's Problem 2: freezing
-- the retail/wholesale rate at Start and billing from the CPO's own trusted
-- CDR at completion, rather than failing closed at Stop forever.
--
-- Purely additive: one new `EvSessionStatus` value, one new
-- `LedgerAccountType` value, and three new nullable/defaulted `EvSession`
-- columns plus one index. Nothing existing changes shape or is backfilled —
-- no session has ever reached `AWAITING_SETTLEMENT` (the only place that
-- reads the three new columns), because `start()` has never yet admitted a
-- `ROAMING_CPO` connector to `CHARGING` in a real deployment (see the
-- security doc: no station has `customerChargingEnabled` by default).

-- AlterEnum
ALTER TYPE "EvSessionStatus" ADD VALUE 'AWAITING_SETTLEMENT';

-- AlterEnum
ALTER TYPE "LedgerAccountType" ADD VALUE 'EV_ROAMING_RECEIVABLE';

-- AlterTable
ALTER TABLE "ev_sessions" ADD COLUMN "settlingAt" TIMESTAMP(3);
ALTER TABLE "ev_sessions" ADD COLUMN "settlementAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ev_sessions" ADD COLUMN "settlementGivenUpAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ev_sessions_status_settlementGivenUpAt_idx" ON "ev_sessions"("status", "settlementGivenUpAt");
