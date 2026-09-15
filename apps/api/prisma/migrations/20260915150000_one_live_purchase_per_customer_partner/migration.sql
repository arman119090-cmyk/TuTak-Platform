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

-- ── Rollout ─────────────────────────────────────────────────────────────
--
-- This migration deliberately **does not** touch a single purchase. Arman's
-- decision of 15.09.2026 is explicit that existing purchases are not to be
-- closed inside a migration to make room for an index, and the reasoning is
-- worth writing down: a customer standing at a till with a live purchase is
-- not a data-quality problem to be tidied away. Expiring their purchase from
-- a deploy script releases their reserved points and voids a code they are
-- about to read out, and it does it without anybody watching.
--
-- If duplicates exist, this migration stops and says so. The rollout that
-- clears them is a sequence of ordinary operations, not a `DELETE`:
--
--   1. **Drain.** Stop accepting new purchases — scale the API down, or turn
--      the create endpoint off. Nothing new can become a duplicate.
--   2. **Let them finish.** The purchase timeout is three minutes
--      (`PURCHASE_INTENT_TIMEOUT_SECONDS`). Wait it out; customers mid-flow
--      confirm or walk away as they normally would.
--   3. **Sweep.** `purchase-intent.expire` runs every 30 seconds and closes
--      what timed out, releasing reservations through the ordinary path that
--      writes audit rows. `SELECT tutak_preflight_one_live_purchase();` (created
--      below) reports what is left, including the purchases held open because
--      a provider may be holding money — those are **not** to be forced; they
--      are resolved by the provider or by a two-person reconciliation.
--   4. **Verify, then migrate.** When the preflight returns no rows, deploy.
--
-- One step this refusal creates, found by rehearsing it rather than by
-- reasoning about it: a refused migration is recorded as *failed* in
-- `_prisma_migrations`, and `migrate deploy` will not continue past it until
-- somebody says what became of it. Nothing here was applied — the check runs
-- before the index — so it is rolled back, not forward:
--
--     prisma migrate resolve --rolled-back 20260915150000_one_live_purchase_per_customer_partner
--
-- Run that after clearing the duplicates and before retrying the deploy.
--
-- The preflight function is left in place afterwards so the same check can be
-- run before the deploy rather than discovered during it.
-- ────────────────────────────────────────────────────────────────────────

DROP INDEX IF EXISTS "purchase_intents_one_live_psp_checkout";

CREATE OR REPLACE FUNCTION "tutak_preflight_one_live_purchase"()
RETURNS TABLE ("customerId" text, "partnerId" text, "liveCount" bigint, "purchaseIds" text[])
AS $$
  SELECT p."customerId", p."partnerId", count(*) AS "liveCount",
         array_agg(p."id" ORDER BY p."createdAt") AS "purchaseIds"
    FROM "purchase_intents" p
   WHERE p."status" = 'AWAITING_CONFIRMATION'
   GROUP BY p."customerId", p."partnerId"
  HAVING count(*) > 1;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION "tutak_preflight_one_live_purchase"() IS
  'Customers with more than one unfinished purchase at the same business. Must return no rows before purchase_intents_one_live_per_customer_partner can be created. Run it before deploying, not during.';

-- Refuse clearly rather than failing on a raw unique violation. A deploy that
-- stops with "23505 duplicate key" tells whoever is watching nothing about
-- what to do next; this tells them exactly how many, for whom, and where the
-- procedure is written down.
DO $$
DECLARE
  offenders integer;
  worst record;
BEGIN
  SELECT count(*) INTO offenders FROM "tutak_preflight_one_live_purchase"();
  IF offenders > 0 THEN
    SELECT * INTO worst FROM "tutak_preflight_one_live_purchase"()
      ORDER BY "liveCount" DESC LIMIT 1;
    RAISE EXCEPTION
      E'Cannot create purchase_intents_one_live_per_customer_partner: % customer/partner pair(s) currently have more than one unfinished purchase (worst: customer % at partner %, % purchases).\n\nDo NOT close them from here. Follow the rollout in this migration''s header: drain, wait out the purchase timeout, let the purchase-intent.expire sweep run, then SELECT * FROM tutak_preflight_one_live_purchase() until it returns no rows.',
      offenders, worst."customerId", worst."partnerId", worst."liveCount";
      -- Deliberately the default P0001 rather than `unique_violation`:
      -- a client that recognises 23505 replaces the message with its own
      -- generic "unique constraint failed", and the message is the whole
      -- value of raising here rather than letting the index fail.

  END IF;
END $$;

CREATE UNIQUE INDEX "purchase_intents_one_live_per_customer_partner"
  ON "purchase_intents" ("customerId", "partnerId")
  WHERE "status" = 'AWAITING_CONFIRMATION';
