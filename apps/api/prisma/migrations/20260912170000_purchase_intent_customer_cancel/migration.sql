-- A customer may withdraw a purchase that no member of staff has acted on
-- yet. That is its own terminal state, not a `REJECTED` row with a
-- different reason string: the partner's queue has to be able to tell a
-- cashier's refusal from a customer walking away, and every later read of
-- the row (partner history, admin, refund eligibility) reads the status.
--
-- `ADD VALUE IF NOT EXISTS` rather than a bare ADD VALUE so re-running the
-- migration history against a database that already has the value (a
-- restored backup mid-deploy, a re-applied shadow database) is not an error;
-- this is the same form the earlier enum-extension migrations in this
-- history use.
ALTER TYPE "PurchaseIntentStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PURCHASE_INTENT_CANCELLED';

-- When the customer cancelled, kept separate from `rejectedAt` for the same
-- reason the status is separate. Null for every existing row, which is
-- correct: none of them was cancelled.
ALTER TABLE "purchase_intents" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);
