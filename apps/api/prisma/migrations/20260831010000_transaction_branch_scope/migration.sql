-- Branch scoping for `transactions`.
--
-- Branch-scoped staff must not read another branch's operation history or
-- its analytics totals. Neither could be expressed as a WHERE clause,
-- because a transaction did not record which branch it happened at — only
-- `PurchaseIntent` did. This adds that column so the restriction lives in
-- the query rather than in a post-filter.
--
-- Forward-only and additive: the column is nullable, so every existing row
-- stays valid and every writer that has no branch to record keeps working
-- unchanged.

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN "partnerBranchId" TEXT;

-- Backfill from the purchase intent that produced the transaction — the one
-- place the branch was already known. Partner ids are compared as well as
-- the transaction link: an intent must never attribute a transaction to a
-- branch belonging to a different partner, and this is the only chance to
-- assert that on historical rows.
UPDATE "transactions" t
SET "partnerBranchId" = pi."partnerBranchId"
FROM "purchase_intents" pi
WHERE pi."sourceTransactionId" = t."id"
  AND pi."partnerBranchId" IS NOT NULL
  AND t."partnerBranchId" IS NULL
  AND t."partnerId" = pi."partnerId";

-- CreateIndex
CREATE INDEX "transactions_partnerBranchId_createdAt_idx" ON "transactions"("partnerBranchId", "createdAt");

-- AddForeignKey
-- SET NULL rather than CASCADE: a transaction is a financial record and must
-- outlive the branch it happened at. Matches `purchase_intents`' own branch FK.
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_partnerBranchId_fkey" FOREIGN KEY ("partnerBranchId") REFERENCES "partner_branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
