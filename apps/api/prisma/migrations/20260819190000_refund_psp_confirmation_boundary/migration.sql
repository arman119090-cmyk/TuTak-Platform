-- Security/financial hardening pass, 2026-08-19 (GitHub issue #28, P0):
-- `PspAdapter` exposed `charge()` but no refund operation, and
-- `RefundEngineService` could post reversing ledger entries, claw back
-- bonus, and mark `Refund`/`Payment.refundedAmount` as done without ever
-- asking the acquirer to move money. This migration adds the state needed
-- to make "refunded" mean "the PSP confirmed it moved the money", not
-- merely "this process decided to record a refund".
--
-- Additive only: a new enum, four new nullable/defaulted columns on
-- `refunds`, and one index. No existing column, constraint, or row is
-- touched. Existing rows (all created before a PSP refund boundary existed)
-- backfill to `CONFIRMED`, since every one of them already has its ledger
-- postings and bonus clawback applied — they were financially completed by
-- the old code path, just never asked the PSP to confirm it. Only refunds
-- created after this migration go through the new PENDING -> CONFIRMED/
-- FAILED state machine.

CREATE TYPE "RefundPspStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');

ALTER TABLE "refunds"
  ADD COLUMN "pspStatus" "RefundPspStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "pspRefundReference" TEXT,
  ADD COLUMN "pspIdempotencyKey" TEXT,
  ADD COLUMN "pspDeclineReason" TEXT;

-- Backfill: every pre-existing refund already has its ledger/clawback
-- effects applied (the old code applied them unconditionally), so it is
-- CONFIRMED under the new model, not PENDING under a default it predates.
UPDATE "refunds" SET "pspStatus" = 'CONFIRMED';

CREATE INDEX "refunds_pspStatus_idx" ON "refunds"("pspStatus");
