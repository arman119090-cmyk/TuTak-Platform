-- Problem 1 (unique bank-transaction control) + Problem 2 (maker-checker on
-- collections). See docs/PARTNER_COLLECTIONS_HARDENING_2026-08-24.md.
--
-- Safety against existing rows in "partner_collections":
--  * "bankTransactionId" is added NULLABLE and never backfilled. Every row
--    that predates this migration was recorded under the old single-step
--    flow, which never captured a bank statement's own transaction id —
--    there is nothing true to backfill it with, and inventing one would
--    fabricate part of the audit trail this whole migration exists to make
--    honest. NOT NULL is enforced going forward at the DTO/service boundary
--    instead (see RecordPartnerCollectionDto / PartnerCollectionService).
--    Postgres does not treat two NULLs as equal in a unique index, so these
--    legacy rows never collide with each other or with a real id under the
--    new unique index below.
--  * "status" is added NULLABLE, backfilled to 'CONFIRMED' for every existing
--    row (true: every row that predates this migration was created by the
--    old single-step path, which posted its ledger transaction immediately
--    — see the pre-migration partner-collection.service.ts), and only then
--    made NOT NULL. This is the safe nullable-then-backfill pattern rather
--    than the "leave it null forever" one used for bankTransactionId, because
--    unlike a bank statement's transaction id, "was this already posted" is
--    something every existing row's own ledgerTransactionId already answers
--    with certainty (backfilling merely writes down what array is already
--    true), and CollectionStatus is a NOT NULL enum column the rest of the
--    service and every query against it depend on always being set.

-- CreateEnum
CREATE TYPE "CollectionStatus" AS ENUM ('PENDING', 'CONFIRMED');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_COLLECTION_CONFIRMED';

-- AlterTable: add the new columns nullable first.
ALTER TABLE "partner_collections" ADD COLUMN "bankTransactionId" TEXT;
ALTER TABLE "partner_collections" ADD COLUMN "status" "CollectionStatus";
ALTER TABLE "partner_collections" ADD COLUMN "confirmedByUserId" TEXT;
ALTER TABLE "partner_collections" ADD COLUMN "confirmedAt" TIMESTAMP(3);

-- Backfill: every pre-existing row was posted immediately by the old
-- single-step flow, so it is truthfully CONFIRMED, not PENDING.
UPDATE "partner_collections" SET "status" = 'CONFIRMED' WHERE "status" IS NULL;

-- Now that every row has a value, the column can be made required. New rows
-- default to the safer state (PENDING) so that any future insert which
-- forgets to set it explicitly fails safe — unconfirmed and unposted —
-- rather than silently landing as already-settled.
ALTER TABLE "partner_collections" ALTER COLUMN "status" SET NOT NULL;
ALTER TABLE "partner_collections" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- CreateIndex: the database-level control Problem 1 exists for. Scoped by
-- currency, matching the one-platform-bank-account-per-currency shape
-- everywhere else in the ledger. NULLs (the legacy rows above) are distinct
-- from one another under Postgres's default unique-index semantics, so they
-- never collide.
CREATE UNIQUE INDEX "partner_collections_currency_bankTransactionId_key" ON "partner_collections"("currency", "bankTransactionId");

-- CreateIndex: lets the dashboard and the confirm flow list PENDING
-- collections without a sequential scan.
CREATE INDEX "partner_collections_status_idx" ON "partner_collections"("status");
