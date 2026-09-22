-- ────────────────────────────────────────────────────────────────────────
-- At most one live in-TuTak checkout per customer per business.
--
-- The cross-purchase double payment the product review of 15.09.2026 found is
-- not a bug inside any one purchase: purchase A collects through the
-- provider and purchase B collects in cash, each settles exactly once, and
-- the customer has paid for one meal twice. `PurchaseIntentsService.assert-
-- NoUnresolvedPayment` is the check that catches it, and it reads the
-- attempt table, which this index cannot.
--
-- What this index adds is the half a read-then-write check can never have:
-- two creates racing each other. Both read no live checkout, both proceed,
-- and the database is the only thing that sees them both. One insert wins.
--
-- Partial on purpose, and narrow on purpose:
--
--   * `DIRECT_PARTNER` purchases are unconstrained. A customer buying twice
--     at the same café in three minutes is an ordinary thing to do, and the
--     money in that route never leaves their hand except to the cashier in
--     front of them.
--   * Only `AWAITING_CONFIRMATION` counts. A settled, rejected, cancelled or
--     expired purchase blocks nothing here — where an *expired* purchase
--     still holds an unresolved provider attempt, the service check is what
--     refuses, because "unresolved" is a fact about the attempt and not
--     about the purchase's status.
-- ────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "purchase_intents_one_live_psp_checkout"
  ON "purchase_intents" ("customerId", "partnerId")
  WHERE "paymentRoute" = 'TUTAK_PSP' AND "status" = 'AWAITING_CONFIRMATION';
