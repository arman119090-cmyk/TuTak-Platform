-- Carry the caller's idempotency key on the refund and the payout, the way
-- 20260809090000 did for payments.
--
-- `idempotency_records` is a separate table written in a separate
-- transaction. A crash between the work committing and the record being
-- completed loses the key, and the retry that follows does the work again.
-- For a payment that was a double charge; for these two it is a refund paid
-- twice and a partner paid twice. Both are bounded — a refund by what remains
-- refundable, a payout by what is owed — and bounded is not safe: an operator
-- who authorised one 500 refund and got two gave away 1,000, every part of it
-- within bounds and the ledger balancing perfectly throughout.
--
-- Demonstrated before it was fixed, in
-- apps/api/test/refund-payout-key-durability.int-spec.ts.

-- `actorId` is new information, not just a constraint: until now nothing on
-- the refund row said who authorised it. The audit log did, and a column on
-- the row the money moved through is the stronger record.
ALTER TABLE "refunds" ADD COLUMN "actorId" TEXT;
ALTER TABLE "refunds" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "payouts" ADD COLUMN "idempotencyKey" TEXT;

-- Nullable and added without a default, so existing rows keep NULL. Postgres
-- permits any number of NULLs in a unique index, so historical rows neither
-- collide with each other nor block the build.
CREATE UNIQUE INDEX IF NOT EXISTS "refunds_actorId_idempotencyKey_key"
  ON "refunds" ("actorId", "idempotencyKey");

CREATE UNIQUE INDEX IF NOT EXISTS "payouts_requestedByUserId_idempotencyKey_key"
  ON "payouts" ("requestedByUserId", "idempotencyKey");
