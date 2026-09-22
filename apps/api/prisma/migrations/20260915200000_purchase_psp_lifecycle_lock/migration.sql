-- ────────────────────────────────────────────────────────────────────────
-- A purchase whose provider may be holding money does not time out.
--
-- The product decision of 15.09.2026, and the hole it closes is a clock racing a
-- payment. The generic three-minute expiry existed long before the provider
-- route did, and it does three things on a purchase it finds stale: releases
-- the bonus reservation, fails the source transaction, and marks the purchase
-- EXPIRED. All three are correct for a customer who walked away from a till.
-- None of them is correct while Idram may already have taken the money:
--
--   * the reservation goes back to the wallet, so the points the customer
--     spent are spendable again — and when the provider's callback finally
--     lands, settlement has nothing to settle;
--   * the source transaction is marked failed, which is a statement about
--     money that nobody has established;
--   * the purchase is EXPIRED, so `settleFromProviderConfirmation` sees a
--     purchase that is no longer awaiting confirmation and returns
--     'already-resolved' — the money moved and the customer got nothing.
--
-- So the rule is: while an attempt is in `MONEY_MAY_HAVE_MOVED`, the purchase
-- is not expirable and not cancellable. It is not stuck — it is *pending*,
-- which is the truth. The PSP ageing sweep escalates it; an authoritative
-- provider answer or a two-person reconciliation releases it; and only then
-- does the ordinary expiry path apply.
--
-- Deliberately not a new `PSP_PENDING` status. The purchase's state has not
-- changed — it is still awaiting confirmation, and confirmation is still what
-- ends it. What changed is who is allowed to end it early, and that is a rule
-- about transitions, not a new state to keep in sync everywhere that reads
-- `PurchaseIntentStatus`.
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION "purchase_intent_not_abandoned_while_paying"()
RETURNS trigger AS $$
DECLARE
  unsafe_id text;
  unsafe_status "PspAttemptStatus";
BEGIN
  -- REJECTED is in the list although the product decision names only expiry and
  -- cancellation: a cashier turning the purchase away while the provider may
  -- hold the money closes it just as thoroughly, and the callback that lands
  -- afterwards has nothing left to complete.
  IF NEW."status" NOT IN ('EXPIRED', 'CANCELLED', 'REJECTED')
     OR OLD."status" = NEW."status" THEN
    RETURN NEW;
  END IF;

  SELECT "id", "status" INTO unsafe_id, unsafe_status
    FROM "psp_payment_attempts"
   WHERE "purchaseIntentId" = NEW."id"
     AND "status" IN ('INITIATED', 'PENDING_CONFIRMATION', 'SUCCEEDED', 'EXPIRED', 'REQUIRES_RECONCILIATION')
   LIMIT 1;

  IF unsafe_id IS NOT NULL THEN
    RAISE EXCEPTION
      'purchase_intents: purchase % cannot become % — payment attempt % is %, so the provider may hold the customer''s money',
      NEW."id", NEW."status", unsafe_id, unsafe_status
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "purchase_intents_not_abandoned_while_paying"
  BEFORE UPDATE ON "purchase_intents"
  FOR EACH ROW EXECUTE FUNCTION "purchase_intent_not_abandoned_while_paying"();

-- ── The same rule, one level down ───────────────────────────────────────
--
-- `releaseExpiredReservations` does not go through `purchase_intents` at all:
-- it reads `bonus_reservations` by its own `expiresAt` and releases whatever
-- it finds. So the trigger above would not have stopped it — the purchase
-- would stay AWAITING_CONFIRMATION with its points already handed back, which
-- is the same loss by a quieter route. Found by reading the sweep rather than
-- by a test, which is why it is written down here.
CREATE OR REPLACE FUNCTION "bonus_reservation_not_released_while_paying"()
RETURNS trigger AS $$
DECLARE
  blocking_id text;
BEGIN
  IF NEW."status" <> 'RELEASED' OR OLD."status" = NEW."status" THEN
    RETURN NEW;
  END IF;
  IF NEW."reasonTransactionId" IS NULL THEN RETURN NEW; END IF;

  SELECT a."id" INTO blocking_id
    FROM "psp_payment_attempts" a
    JOIN "purchase_intents" p ON p."id" = a."purchaseIntentId"
   WHERE p."sourceTransactionId" = NEW."reasonTransactionId"
     AND p."status" = 'AWAITING_CONFIRMATION'
     AND a."status" IN ('INITIATED', 'PENDING_CONFIRMATION', 'SUCCEEDED', 'EXPIRED', 'REQUIRES_RECONCILIATION')
   LIMIT 1;

  IF blocking_id IS NOT NULL THEN
    RAISE EXCEPTION
      'bonus_reservations: reservation % backs a purchase whose payment attempt % is unresolved and cannot be released',
      NEW."id", blocking_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "bonus_reservations_not_released_while_paying"
  BEFORE UPDATE ON "bonus_reservations"
  FOR EACH ROW EXECUTE FUNCTION "bonus_reservation_not_released_while_paying"();

-- Reading `psp_payment_attempts` by purchase and status happens on every
-- expiry sweep tick now, so it gets an index rather than a sequential scan
-- of every attempt ever made.
CREATE INDEX "psp_payment_attempts_purchaseIntentId_status_idx"
  ON "psp_payment_attempts"("purchaseIntentId", "status");
