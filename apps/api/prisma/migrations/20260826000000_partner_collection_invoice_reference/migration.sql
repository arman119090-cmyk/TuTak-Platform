-- Adds an optional invoice/фактура reference to partner_collections, purely
-- for reconciliation against the accountant's own paper trail (TuTak does
-- not generate or store invoices itself, so this is never required and
-- never the uniqueness key -- that stays "bankTransactionId").
--
-- Nullable forever, no backfill: no pre-existing row has a true invoice
-- number to recover, and inventing one would fabricate part of the record
-- this column exists to make honest.

-- AlterTable
ALTER TABLE "partner_collections" ADD COLUMN "invoiceReference" TEXT;
