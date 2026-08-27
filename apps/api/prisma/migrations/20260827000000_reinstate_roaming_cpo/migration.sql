-- Reinstates the wholesale-resale EV-charging-partner structure that
-- 20260826040000_remove_fastcharge (since deleted from this migrations
-- folder — see docs/ROAMING_CPO_INTEGRATION_2026-08-25.md's 2026-08-27
-- update) dropped, this time under a generic `ROAMING_CPO` name instead of
-- the FastCharge brand: TuTak has moved on to a different EV-charging
-- partner, and this is exactly the structure that partner integration will
-- reuse, without hardcoding any brand name into the schema.

-- AlterEnum
ALTER TYPE "EvStationProvider" ADD VALUE 'ROAMING_CPO';

-- AlterTable
ALTER TABLE "ev_connectors" ADD COLUMN     "externalConnectorId" TEXT;

-- AlterTable
ALTER TABLE "ev_sessions" ADD COLUMN     "appliedCustomerRatePerKwh" DECIMAL(10,2),
ADD COLUMN     "externalCustomerId" TEXT,
ADD COLUMN     "externalSessionId" TEXT,
ADD COLUMN     "marginPerKwh" DECIMAL(10,2),
ADD COLUMN     "marginReferralCapPerKwh" DECIMAL(10,2),
ADD COLUMN     "stationRetailRatePerKwh" DECIMAL(10,2),
ADD COLUMN     "uncappedMarginRevenueAmount" DECIMAL(18,4),
ADD COLUMN     "wholesaleRatePerKwh" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "ev_stations" ADD COLUMN     "externalStationId" TEXT,
ADD COLUMN     "standardRetailRatePerKwh" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "partners" ADD COLUMN     "evMarginReferralCapPerKwh" DECIMAL(10,2) NOT NULL DEFAULT 20.00,
ADD COLUMN     "evWholesaleRatePerKwh" DECIMAL(10,2) NOT NULL DEFAULT 75.00;

-- CreateTable
CREATE TABLE "partner_api_keys" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "integrationId" TEXT,
    "keyId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "label" TEXT,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roaming_customer_links" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "externalCustomerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roaming_customer_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "partner_api_keys_keyId_key" ON "partner_api_keys"("keyId");

-- CreateIndex
CREATE INDEX "partner_api_keys_partnerId_idx" ON "partner_api_keys"("partnerId");

-- CreateIndex
CREATE INDEX "roaming_customer_links_userId_idx" ON "roaming_customer_links"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "roaming_customer_links_partnerId_externalCustomerId_key" ON "roaming_customer_links"("partnerId", "externalCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "ev_connectors_externalConnectorId_key" ON "ev_connectors"("externalConnectorId");

-- CreateIndex
CREATE UNIQUE INDEX "ev_sessions_externalSessionId_key" ON "ev_sessions"("externalSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "ev_stations_externalStationId_key" ON "ev_stations"("externalStationId");

-- AddForeignKey
ALTER TABLE "partner_api_keys" ADD CONSTRAINT "partner_api_keys_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_api_keys" ADD CONSTRAINT "partner_api_keys_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "partner_integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roaming_customer_links" ADD CONSTRAINT "roaming_customer_links_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roaming_customer_links" ADD CONSTRAINT "roaming_customer_links_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
