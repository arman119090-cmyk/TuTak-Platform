-- Enum additions live in their own migration: PostgreSQL refuses to use a
-- new enum value inside the same transaction that created it, and Prisma
-- wraps each migration file in one transaction.
--
-- Splits ledger entries into two families (see the next migration):
--   VALUE    — changes how many points the wallet holds
--   TRANSFER — moves points between buckets, total unchanged
ALTER TYPE "BonusEntryType" ADD VALUE IF NOT EXISTS 'RESERVE_HOLD';
ALTER TYPE "BonusEntryType" ADD VALUE IF NOT EXISTS 'RESERVE_RELEASE';
ALTER TYPE "BonusEntryType" ADD VALUE IF NOT EXISTS 'PENDING_PROMOTION';

-- TRANSFER entries neither create nor destroy points.
ALTER TYPE "LedgerDirection" ADD VALUE IF NOT EXISTS 'NEUTRAL';
