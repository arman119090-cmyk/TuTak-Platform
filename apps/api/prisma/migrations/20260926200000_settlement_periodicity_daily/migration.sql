-- Partner Commerce settlement integration, step 1 (docs/PARTNER_COMMERCE.md §14).
--
-- `Partner.settlementPeriodicity` becomes the one settlement cadence, and
-- Partner Commerce partners may be settled daily. Added in its own migration
-- so that, should step 2 stop on a conflicting cadence, an operator can
-- already set DAILY by hand before re-running it.
ALTER TYPE "SettlementPeriodicity" ADD VALUE IF NOT EXISTS 'DAILY' BEFORE 'WEEKLY';
