-- TuTak no longer works with FastCharge (Arman, 2026-08-26: "мы больше с
-- ними не работаем, у нас другой партнёр"). This reverses the whole
-- FastCharge wholesale-resale integration's schema footprint: every
-- FASTCHARGE-provider station (and its connectors/sessions/reservations/CDRs)
-- is deleted outright rather than orphaned, then every FastCharge-only
-- column/table/enum-value is dropped. `partner_api_keys` is dropped too --
-- its only consumer was the FastCharge M2M webhook auth, so it is dead code
-- once that module is gone, not shared infrastructure.
--
-- Generic roaming/OCPI columns (`ocpiEvseUid`, `ocpiLocationId`, the `EvCdr`
-- model, `OCPI_*` config) are untouched -- they predate FastCharge and serve
-- any CPO, not just this one.

-- Delete FASTCHARGE-provider data. No ON DELETE CASCADE exists from
-- ev_connectors to ev_sessions/ev_reservations, so those go first;
-- ev_cdrs cascades from ev_sessions, and ev_connectors cascades from
-- ev_stations, so neither needs an explicit delete.
DELETE FROM "ev_sessions"
WHERE "connectorId" IN (
  SELECT c."id" FROM "ev_connectors" c
  JOIN "ev_stations" s ON s."id" = c."stationId"
  WHERE s."provider" = 'FASTCHARGE'
);

DELETE FROM "ev_reservations"
WHERE "connectorId" IN (
  SELECT c."id" FROM "ev_connectors" c
  JOIN "ev_stations" s ON s."id" = c."stationId"
  WHERE s."provider" = 'FASTCHARGE'
);

DELETE FROM "ev_stations" WHERE "provider" = 'FASTCHARGE';

-- Drop FastCharge-exclusive tables.
DROP TABLE "fastcharge_customer_links";
DROP TABLE "partner_api_keys";

-- Drop FastCharge-exclusive columns.
ALTER TABLE "partners" DROP COLUMN "evWholesaleRatePerKwh";
ALTER TABLE "partners" DROP COLUMN "evMarginReferralCapPerKwh";

ALTER TABLE "ev_stations" DROP COLUMN "externalStationId";
ALTER TABLE "ev_stations" DROP COLUMN "standardRetailRatePerKwh";

ALTER TABLE "ev_connectors" DROP COLUMN "externalConnectorId";

ALTER TABLE "ev_sessions" DROP COLUMN "fastChargeExternalSessionId";
ALTER TABLE "ev_sessions" DROP COLUMN "fastChargeCustomerId";
ALTER TABLE "ev_sessions" DROP COLUMN "stationRetailRatePerKwh";
ALTER TABLE "ev_sessions" DROP COLUMN "appliedCustomerRatePerKwh";
ALTER TABLE "ev_sessions" DROP COLUMN "wholesaleRatePerKwh";
ALTER TABLE "ev_sessions" DROP COLUMN "marginReferralCapPerKwh";
ALTER TABLE "ev_sessions" DROP COLUMN "marginPerKwh";
ALTER TABLE "ev_sessions" DROP COLUMN "uncappedMarginRevenueAmount";

-- Postgres has no ALTER TYPE ... DROP VALUE, so the enum is recreated
-- without FASTCHARGE (every remaining row is already 'INTERNAL', deleted
-- above otherwise).
ALTER TYPE "EvStationProvider" RENAME TO "EvStationProvider_old";
CREATE TYPE "EvStationProvider" AS ENUM ('INTERNAL');
ALTER TABLE "ev_stations" ALTER COLUMN "provider" DROP DEFAULT;
ALTER TABLE "ev_stations" ALTER COLUMN "provider" TYPE "EvStationProvider" USING ("provider"::text::"EvStationProvider");
ALTER TABLE "ev_stations" ALTER COLUMN "provider" SET DEFAULT 'INTERNAL';
DROP TYPE "EvStationProvider_old";
