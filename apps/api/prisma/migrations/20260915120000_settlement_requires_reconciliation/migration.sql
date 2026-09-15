-- Alone in its own migration on purpose.
--
-- PostgreSQL refuses to *use* an enum value that was added by the same
-- transaction, and `prisma migrate deploy` wraps each file in one. The next
-- migration's CHECK constraints name this value, so adding it here is the
-- only way both can be applied by the same `deploy` run.
ALTER TYPE "PartnerSettlementStatus" ADD VALUE 'REQUIRES_RECONCILIATION';
