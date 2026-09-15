-- The documented rollout, performed.
--
-- This is step 2 and step 3 of the procedure written into
-- `20260915150000_one_live_purchase_per_customer_partner`, done here the way
-- an operator would do it on the night:
--
--   2. the purchase timeout passes — nothing new is being created, so every
--      live purchase reaches its own `expiresAt`;
--   3. `purchase-intent.expire` closes what timed out.
--
-- Deliberately NOT a `DELETE`, and deliberately not inside the migration.
-- Closing a customer's live purchase from a deploy script releases their
-- reserved points and voids a code they are about to read out, with nobody
-- watching. Here it is an explicit operational act, in its own file, that
-- somebody runs and can see the result of.
--
-- The sweep in the running application does more than this — it releases the
-- bonus reservation and fails the source transaction through the paths that
-- write audit rows. This file stands in for it in the rehearsal only.

-- Step 2: the timeout passes.
UPDATE purchase_intents
   SET "expiresAt" = now() - interval '1 minute'
 WHERE status = 'AWAITING_CONFIRMATION';

-- Step 3: the sweep closes what timed out. Note it leaves alone anything
-- whose payment is unresolved — in the running system that rule is a
-- database trigger, and those purchases are resolved by the provider or by a
-- two-person reconciliation, never forced.
UPDATE purchase_intents
   SET status = 'EXPIRED'
 WHERE status = 'AWAITING_CONFIRMATION'
   AND "expiresAt" < now();

-- Step 4: verify. The migration will refuse again if this reports anything.
SELECT count(*) AS "remaining duplicate pairs" FROM (
  SELECT "customerId", "partnerId"
    FROM purchase_intents
   WHERE status = 'AWAITING_CONFIRMATION'
   GROUP BY "customerId", "partnerId"
  HAVING count(*) > 1
) dupes;
