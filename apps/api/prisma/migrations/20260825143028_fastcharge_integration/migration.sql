-- CreateEnum
CREATE TYPE "EvStationProvider" AS ENUM ('INTERNAL', 'FASTCHARGE');

-- AlterTable
ALTER TABLE "ev_connectors" ADD COLUMN     "externalConnectorId" TEXT;

-- AlterTable
ALTER TABLE "ev_sessions" ADD COLUMN     "appliedCustomerRatePerKwh" DECIMAL(10,2),
ADD COLUMN     "fastChargeCustomerId" TEXT,
ADD COLUMN     "fastChargeExternalSessionId" TEXT,
ADD COLUMN     "marginPerKwh" DECIMAL(10,2),
ADD COLUMN     "marginReferralCapPerKwh" DECIMAL(10,2),
ADD COLUMN     "stationRetailRatePerKwh" DECIMAL(10,2),
ADD COLUMN     "uncappedMarginRevenueAmount" DECIMAL(18,4),
ADD COLUMN     "wholesaleRatePerKwh" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "ev_stations" ADD COLUMN     "externalStationId" TEXT,
ADD COLUMN     "provider" "EvStationProvider" NOT NULL DEFAULT 'INTERNAL',
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
CREATE TABLE "fastcharge_customer_links" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "fastChargeCustomerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fastcharge_customer_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "partner_api_keys_keyId_key" ON "partner_api_keys"("keyId");

-- CreateIndex
CREATE INDEX "partner_api_keys_partnerId_idx" ON "partner_api_keys"("partnerId");

-- CreateIndex
CREATE INDEX "fastcharge_customer_links_userId_idx" ON "fastcharge_customer_links"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "fastcharge_customer_links_partnerId_fastChargeCustomerId_key" ON "fastcharge_customer_links"("partnerId", "fastChargeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "ev_connectors_externalConnectorId_key" ON "ev_connectors"("externalConnectorId");

-- CreateIndex
CREATE UNIQUE INDEX "ev_sessions_fastChargeExternalSessionId_key" ON "ev_sessions"("fastChargeExternalSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "ev_stations_externalStationId_key" ON "ev_stations"("externalStationId");

-- CreateIndex
CREATE INDEX "ev_stations_partnerId_provider_idx" ON "ev_stations"("partnerId", "provider");

-- AddForeignKey
ALTER TABLE "partner_api_keys" ADD CONSTRAINT "partner_api_keys_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_api_keys" ADD CONSTRAINT "partner_api_keys_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "partner_integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fastcharge_customer_links" ADD CONSTRAINT "fastcharge_customer_links_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fastcharge_customer_links" ADD CONSTRAINT "fastcharge_customer_links_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

