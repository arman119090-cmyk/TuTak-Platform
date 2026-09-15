-- ────────────────────────────────────────────────────────────────────────
-- One live purchase per customer per business, whatever route it collects on.
--
-- ## The race this closes, which the previous index did not
--
-- `20260915130000_one_live_psp_checkout` constrained only `TUTAK_PSP` rows,
-- and `assertNoUnresolvedPayment` reads `psp_payment_attempts`. Between them
-- was a window neither could see, found by Arman on 15.09.2026:
--
--   1. purchase A is created on `TUTAK_PSP`. **No attempt row exists yet** —
--      the customer has not pressed "pay" — so the service check finds
--      nothing to object to.
--   2. purchase B is created on `DIRECT_PARTNER`. The old index did not
--      constrain `DIRECT_PARTNER` at all, so B is created and confirmed at
--      the till. The customer pays cash.
--   3. `beginAttempt(A)` now opens a real Idram bill against a purchase that
--      has already been paid for, and the customer pays a second time.
--
-- The hole was that both guards were about *payment attempts*, and step 1 is
-- a purchase with no attempt. So the invariant is moved up a level, off the
-- attempt and onto the purchase itself: **a customer has at most one
-- unfinished purchase at a business, and the route is irrelevant to that.**
--
-- ## Why this shape
--
--   * Partial on `AWAITING_CONFIRMATION` — the one non-final status. A
--     purchase that is CONFIRMED, REJECTED, CANCELLED or EXPIRED is over,
--     and the customer may start a new one immediately; Arman's decision of
--     15.09.2026 is explicit that ordinary repeat business must not be
--     blocked once the previous purchase is genuinely finished.
--   * Route-independent, unlike the index it replaces. That was the bug.
--   * It does **not** cover an EXPIRED purchase whose provider attempt is
--     still unresolved: the purchase is final there but the money is not, and
--     that case belongs to `assertNoUnresolvedPayment`, which reads the
--     attempt. The two guards are deliberately different questions — "is
--     another purchase in flight" and "might the provider be holding money" —
--     and neither subsumes the other.
-- ────────────────────────────────────────────────────────────────────────

DROP INDEX IF EXISTS "purchase_intents_one_live_psp_checkout";

CREATE UNIQUE INDEX "purchase_intents_one_live_per_customer_partner"
  ON "purchase_intents" ("customerId", "partnerId")
  WHERE "status" = 'AWAITING_CONFIRMATION';
