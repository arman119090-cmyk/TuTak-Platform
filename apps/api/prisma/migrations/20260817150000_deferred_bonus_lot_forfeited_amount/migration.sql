-- Separates "this lot's own originating purchase was refunded" from "an
-- external contributing purchase's refund invalidated a grant that had
-- already been partly spent" — independent audit, GitHub issue #28.
-- `reverseUnlock` used to reuse `refundedAmount` for both, leaving the lot
-- permanently `AVAILABLE`/exhausted even when its own purchase was never
-- refunded, so it could never accumulate turnover or unlock again. Only the
-- genuinely-unrecoverable (already spent) slice of an invalidated grant is
-- ever permanently forfeited; the reclaimed, unspent portion returns to
-- ordinary outstanding BONUS_LIABILITY and remains grantable again.

ALTER TABLE "deferred_bonus_lots" ADD COLUMN "forfeitedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE "deferred_bonus_lots"
  DROP CONSTRAINT IF EXISTS "deferred_bonus_lots_refunded_within_amount",
  ADD CONSTRAINT "deferred_bonus_lots_refunded_within_amount" CHECK (
    "refundedAmount" >= 0
    AND "forfeitedAmount" >= 0
    AND ("refundedAmount" + "forfeitedAmount") <= "amount"
  );
