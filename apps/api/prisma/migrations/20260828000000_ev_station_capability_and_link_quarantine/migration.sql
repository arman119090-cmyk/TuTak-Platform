-- Problems 2 & 3 (docs/ROAMING_CPO_INTEGRATION_2026-08-27-SECURITY.md):
-- explicit per-station charging capabilities, and quarantining every
-- roaming-CPO customer link created by the removed customer-entered
-- linking flow.

-- AlterTable
ALTER TABLE "ev_stations"
  ADD COLUMN "customerChargingEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "remoteStartSupported" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "remoteStopSupported" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "trustedTelemetrySupported" BOOLEAN NOT NULL DEFAULT false;

-- INTERNAL stations are TuTak's own hardware: they have always been
-- customer-chargeable, started/stopped directly with no remote party and no
-- trusted-telemetry question to ask. Backfilling them to true changes
-- nothing about how any existing station behaves; every ROAMING_CPO station
-- keeps the safe `false` default until explicitly proven and enabled.
UPDATE "ev_stations"
SET "customerChargingEnabled" = true,
    "remoteStartSupported" = true,
    "remoteStopSupported" = true,
    "trustedTelemetrySupported" = true
WHERE "provider" = 'INTERNAL';

-- CreateIndex
CREATE INDEX "ev_stations_customerChargingEnabled_idx" ON "ev_stations"("customerChargingEnabled");

-- AlterTable
ALTER TABLE "roaming_customer_links" ADD COLUMN "verifiedAt" TIMESTAMP(3);

-- Every link created before this migration came from the removed
-- customer-entered flow (`RoamingCpoCustomersService.link`), which accepted
-- an arbitrary self-reported externalCustomerId with no proof of ownership.
-- Leaving `verifiedAt` null quarantines all of them: `verifiedAt IS NULL` is
-- exactly the condition `RoamingCpoSettlementService.settleOnce` now checks
-- before it will settle money against a link. No row is silently promoted
-- to verified, and no row is reassigned or deleted — nothing here changes
-- which user a link points at, only whether it may fund a settlement yet.
