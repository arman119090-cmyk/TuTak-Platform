-- The caller's idempotency key, carried on the payment itself.
--
-- `idempotency_records` already tracks these, but it is a separate table
-- written in a separate transaction. Killing Postgres in the middle of a
-- capture left a committed payment whose record had been deleted by the
-- failure path, and replaying that key charged the customer a second time.
-- With the key on the payment under a unique index, the database refuses the
-- second charge no matter what happened to the record.
--
-- Nullable, and added without a default: payments written before this column
-- existed have no key, and a unique index in Postgres permits any number of
-- NULLs, so those rows neither collide with each other nor block the index.
ALTER TABLE "payments" ADD COLUMN "idempotencyKey" TEXT;

-- CONCURRENTLY is deliberately not used. It cannot run inside the transaction
-- Prisma wraps a migration in, and on a table this size the plain build is a
-- brief lock rather than an outage. On a payments table large enough for that
-- to matter, build it by hand outside the migration first and let this become
-- a no-op via IF NOT EXISTS.
CREATE UNIQUE INDEX IF NOT EXISTS "payments_userId_idempotencyKey_key"
  ON "payments" ("userId", "idempotencyKey");
