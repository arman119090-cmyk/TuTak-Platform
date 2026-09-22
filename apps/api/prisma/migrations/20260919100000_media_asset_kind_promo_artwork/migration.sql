-- A fourth media kind: artwork for one Home "Partner Spotlight" placement.
--
-- Its own migration, on its own, because PostgreSQL will not let a
-- transaction that adds an enum value also *use* that value — and the next
-- migration's CHECK constraint and partial index both name it. Prisma runs
-- each migration in its own transaction, so splitting them is what makes the
-- second one legal.
ALTER TYPE "MediaAssetKind" ADD VALUE 'PROMO_ARTWORK';

-- The two audit actions the placements need. Same rule: added here, used in
-- the next migration's world, never in this transaction.
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_PROMO_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_PROMO_UPDATED';
