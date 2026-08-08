-- Records who confirmed a payout, separately from who requested it.
--
-- Nullable, and deliberately not backfilled: payouts confirmed before this
-- column existed have no second approver, and writing one in would be
-- inventing an audit trail. A NULL here means "confirmed under the old
-- single-approver rule", which is the truth.
ALTER TABLE "payouts" ADD COLUMN "confirmedByUserId" TEXT;
