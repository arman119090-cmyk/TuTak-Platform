-- Splits the customer-facing "fuel" filter into gas and petrol, so a
-- customer can find a station that sells what they actually need instead of
-- one generic "АЗС" chip (Arman, 2026-08-26). Propane and methane are one
-- customer-facing bucket ("Газ"), not two -- both flags are on `Partner`
-- because that is where `category` already lives, and both default false
-- since no existing "fuel" partner has declared what it sells yet.

-- AlterTable
ALTER TABLE "partners" ADD COLUMN "sellsGas" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "partners" ADD COLUMN "sellsPetrol" BOOLEAN NOT NULL DEFAULT false;
