-- Permissions for the financial core's HTTP surface.
--
-- Deliberately three separate permissions rather than folding these into
-- PARTNER_MANAGE: editing a partner's details, moving money back out of
-- their balance, and wiring money to an external bank are three different
-- levels of trust, and an operator who needs the first should not silently
-- acquire the third.
--
-- Postgres 12+ allows ADD VALUE inside a transaction as long as the new
-- value is not used in the same transaction. Nothing below uses them; the
-- seed grants them on its next run.
ALTER TYPE "PermissionName" ADD VALUE 'PAYMENT_REFUND';
ALTER TYPE "PermissionName" ADD VALUE 'PAYOUT_MANAGE';
ALTER TYPE "PermissionName" ADD VALUE 'LEDGER_READ';

-- Audit actions for money movement. An audit log that records role changes
-- but not who refunded what is missing the entries an investigation would
-- actually start from.
ALTER TYPE "AuditAction" ADD VALUE 'PAYMENT_REFUNDED';
ALTER TYPE "AuditAction" ADD VALUE 'PAYOUT_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE 'PAYOUT_RESOLVED';
ALTER TYPE "AuditAction" ADD VALUE 'PAYOUT_BLOCK_CLEARED';
ALTER TYPE "AuditAction" ADD VALUE 'RECONCILIATION_RUN';
