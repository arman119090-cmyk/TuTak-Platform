-- A top-up the provider has not answered is not declined and not failed:
-- the customer may have paid. `UNRESOLVED` names that state so a late
-- webhook can still credit it exactly once and an operator can see it
-- rather than a silent PENDING that ages for ever.
ALTER TYPE "BalanceTopUpStatus" ADD VALUE 'UNRESOLVED';

ALTER TABLE "balance_top_ups"
  ADD COLUMN "resolvedAt" TIMESTAMP(3),
  ADD COLUMN "unresolvedAt" TIMESTAMP(3),
  ADD COLUMN "escalatedAt" TIMESTAMP(3),
  ADD COLUMN "escalationCount" INTEGER NOT NULL DEFAULT 0;
