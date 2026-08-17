-- `deferred_bonus_lots_amounts_sane` requires `amount > 0` unconditionally,
-- so a PurchaseIntentRefundService refund cannot represent "this lot's
-- entitlement was reduced to zero" by decrementing `amount` itself. Tracked
-- separately instead, the same way `PurchaseIntent.refundedAmount` tracks
-- its own refunds against the immutable `grossAmount`.

-- AlterTable
ALTER TABLE "deferred_bonus_lots" ADD COLUMN "refundedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE "deferred_bonus_lots"
  ADD CONSTRAINT "deferred_bonus_lots_refunded_within_amount" CHECK (
    "refundedAmount" >= 0 AND "refundedAmount" <= "amount"
  );
