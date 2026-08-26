-- Lets a partner deactivate a branch (e.g. it closed) without deleting the
-- row -- PurchaseIntent and PartnerIntegration reference a branch by id, and
-- that history must keep resolving to the location it actually happened at.
--
-- DEFAULT true, no separate backfill needed: every branch that predates this
-- column really is still open as far as the platform knows -- there is no
-- historical signal that any of them should start out deactivated.

-- AlterTable
ALTER TABLE "partner_branches" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
