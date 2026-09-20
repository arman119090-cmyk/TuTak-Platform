-- Till-opened purchases (POS), claimed by a customer through a dynamic QR.
-- The amount is partner-originated; everything after the claim is the
-- ordinary PurchaseIntent engine.
CREATE TYPE "PartnerCheckoutStatus" AS ENUM ('OPEN', 'CLAIMED', 'CANCELLED', 'EXPIRED');

CREATE TABLE "partner_checkouts" (
  "id" TEXT NOT NULL,
  "partnerId" TEXT NOT NULL,
  "partnerBranchId" TEXT,
  "apiKeyId" TEXT NOT NULL,
  "externalReference" TEXT NOT NULL,
  "idempotencyKey" TEXT,
  "status" "PartnerCheckoutStatus" NOT NULL DEFAULT 'OPEN',
  "grossAmount" DECIMAL(18,4) NOT NULL,
  "quantity" DECIMAL(18,4),
  "quantityUnit" "UnitOfMeasure",
  "unitPrice" DECIMAL(18,4),
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "token" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "purchaseIntentId" TEXT,
  "claimedByUserId" TEXT,
  "claimedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "partner_checkouts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "partner_checkouts_token_key" ON "partner_checkouts"("token");
CREATE UNIQUE INDEX "partner_checkouts_purchaseIntentId_key" ON "partner_checkouts"("purchaseIntentId");
-- The till's own receipt id is unique per partner: a retried POS call can
-- never open the same sale twice.
CREATE UNIQUE INDEX "partner_checkouts_partnerId_externalReference_key" ON "partner_checkouts"("partnerId", "externalReference");
CREATE UNIQUE INDEX "partner_checkouts_partnerId_idempotencyKey_key" ON "partner_checkouts"("partnerId", "idempotencyKey");
CREATE INDEX "partner_checkouts_partnerId_status_idx" ON "partner_checkouts"("partnerId", "status");
CREATE INDEX "partner_checkouts_status_expiresAt_idx" ON "partner_checkouts"("status", "expiresAt");

ALTER TABLE "partner_checkouts" ADD CONSTRAINT "partner_checkouts_partnerId_fkey"
  FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "partner_checkouts" ADD CONSTRAINT "partner_checkouts_partnerBranchId_fkey"
  FOREIGN KEY ("partnerBranchId") REFERENCES "partner_branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "partner_checkouts" ADD CONSTRAINT "partner_checkouts_apiKeyId_fkey"
  FOREIGN KEY ("apiKeyId") REFERENCES "partner_api_keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "partner_checkouts" ADD CONSTRAINT "partner_checkouts_purchaseIntentId_fkey"
  FOREIGN KEY ("purchaseIntentId") REFERENCES "purchase_intents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "partner_checkouts" ADD CONSTRAINT "partner_checkouts_claimedByUserId_fkey"
  FOREIGN KEY ("claimedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A claimed checkout names who claimed it and what it became; an unclaimed
-- one names neither. The purchase link may later be cleared only by the
-- purchase row being deleted (ON DELETE SET NULL), which this platform never
-- does to a financial record.
ALTER TABLE "partner_checkouts" ADD CONSTRAINT "partner_checkouts_claim_is_complete" CHECK (
  ("status" <> 'CLAIMED' AND "claimedByUserId" IS NULL AND "claimedAt" IS NULL)
  OR ("status" = 'CLAIMED' AND "claimedByUserId" IS NOT NULL AND "claimedAt" IS NOT NULL)
);

ALTER TABLE "partner_checkouts" ADD CONSTRAINT "partner_checkouts_gross_positive" CHECK ("grossAmount" > 0);
ALTER TABLE "partner_checkouts" ADD CONSTRAINT "partner_checkouts_quantity_is_complete" CHECK (
  ("quantity" IS NULL AND "quantityUnit" IS NULL AND "unitPrice" IS NULL)
  OR ("quantity" IS NOT NULL AND "quantityUnit" IS NOT NULL AND "unitPrice" IS NOT NULL)
);
