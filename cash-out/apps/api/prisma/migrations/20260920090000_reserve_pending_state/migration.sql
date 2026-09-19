-- Yandex Fleet API v3 answers a transaction POST with a status that can be
-- `in_progress`: the transaction exists and has an id, but its outcome is not
-- final. That is neither "applied" nor "unknown", so it gets its own state.
ALTER TYPE "WithdrawalState" ADD VALUE IF NOT EXISTS 'RESERVE_PENDING' AFTER 'RESERVE_UNCERTAIN';

-- The compensating credit is its own v3 transaction with its own id, and a
-- credit that comes back `in_progress` has to be followed up by that id.
ALTER TABLE "withdrawals" ADD COLUMN "yandexReversalTransactionId" TEXT;
