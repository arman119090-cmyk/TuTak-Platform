-- What must be true of the legacy rows after this branch's migrations.
--
-- Every check below corresponds to a migration that reads or rewrites
-- existing data. A silent pass is worthless, so each one raises on failure
-- and the script prints what it found.
\set ON_ERROR_STOP on

DO $$
DECLARE
  n integer;
  txt text;
BEGIN
  -- ── Nothing was destroyed ─────────────────────────────────────────────
  SELECT count(*) INTO n FROM purchase_intents;
  IF n <> 4 THEN RAISE EXCEPTION 'purchase_intents: expected 4 rows, found %', n; END IF;

  -- Closed by the *rollout*, in step 3b, not by a migration. The proof that
  -- no migration closed them is in step 3a: the refused deploy left both
  -- alive, and the script fails if it did not.
  SELECT count(*) INTO n FROM purchase_intents WHERE status = 'AWAITING_CONFIRMATION';
  IF n <> 0 THEN
    RAISE EXCEPTION 'Expected the rollout to have closed both live purchases, found % live', n;
  END IF;
  SELECT count(*) INTO n FROM purchase_intents WHERE status = 'EXPIRED';
  IF n <> 3 THEN
    RAISE EXCEPTION 'Expected 3 expired purchases after the rollout, found %', n;
  END IF;

  -- No legacy settlements exist to check: the engine arrives with this
  -- branch, so `partner_settlements` is new and necessarily empty. The table
  -- must exist, though — a migration that failed halfway would leave it out.
  SELECT count(*) INTO n FROM partner_settlements;
  IF n <> 0 THEN RAISE EXCEPTION 'partner_settlements should be empty on a fresh upgrade, found %', n; END IF;

  SELECT count(*) INTO n FROM payments;
  IF n <> 1 THEN RAISE EXCEPTION 'payments: expected 1 legacy row, found %', n; END IF;
  SELECT count(*) INTO n FROM refunds;
  IF n <> 1 THEN RAISE EXCEPTION 'refunds: expected 1 legacy row, found %', n; END IF;

  -- ── The merchant-approval back-fill describes history truthfully ──────
  --
  -- A confirmed purchase was confirmed by a cashier looking at it, which is
  -- exactly what merchant approval means. Marking it unapproved would imply
  -- nobody ever checked.
  SELECT "merchantApprovedByUserId" INTO txt FROM purchase_intents WHERE id = 'pi-done-1';
  IF txt IS DISTINCT FROM 'u-cashier' THEN
    RAISE EXCEPTION 'Confirmed purchase was not back-filled with its cashier, got %', txt;
  END IF;

  -- An unfinished purchase was approved by nobody, and must say so.
  SELECT count(*) INTO n FROM purchase_intents
   WHERE status = 'AWAITING_CONFIRMATION' AND "merchantApprovedAt" IS NOT NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'A live purchase was back-filled as approved'; END IF;

  -- ── Contribution rules: existing rows are in force, not proposals ─────
  SELECT count(*) INTO n FROM partner_contribution_rules WHERE status = 'PROPOSED';
  IF n <> 0 THEN
    RAISE EXCEPTION 'An existing rule was described as an unapproved proposal';
  END IF;

  -- ── The preflight function exists and reports the truth ───────────────
  SELECT count(*) INTO n FROM "tutak_preflight_one_live_purchase"();
  IF n <> 0 THEN
    RAISE EXCEPTION 'Preflight still reports % offending pair(s) after the rollout', n;
  END IF;

  RAISE NOTICE 'legacy rows intact: 4 purchases, 1 payment, 1 refund — none deleted';
  RAISE NOTICE 'back-fills correct: confirmed purchase carries its cashier, live ones unapproved';
  RAISE NOTICE 'preflight is clean after the rollout';
END $$;

-- ── Unit conversion, exercised for real ─────────────────────────────────
--
-- The seed cannot contain a free-text unit: main's schema has no
-- `partner_contribution_rules` table at all, so there is nothing to convert
-- from. What *can* be proved is that the enum refuses what the mapping would
-- have had to guess at, which is the property the migration relies on.
DO $$
BEGIN
  BEGIN
    EXECUTE $q$INSERT INTO partner_contribution_rules
                 (id, "partnerId", status, kind, "fixedPerUnit", unit, "proposedByUserId")
               VALUES ('cr-bad', 'p-haze', 'PROPOSED', 'FIXED_PER_UNIT', 10, 'litre', 'u-finance-a')$q$;
    RAISE EXCEPTION 'A free-text unit was accepted; the enum is not doing its job';
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE NOTICE 'unit vocabulary is closed: "litre" refused';
  END;
END $$;

-- And a real rule, proposed and approved, prices HAZE the way it should.
INSERT INTO partner_contribution_rules
  (id, "partnerId", status, kind, "fixedPerUnit", unit, "proposedByUserId")
VALUES ('cr-haze', 'p-haze', 'PROPOSED', 'FIXED_PER_UNIT', 10, 'LITER', 'u-finance-a');

DO $$
BEGIN
  BEGIN
    UPDATE partner_contribution_rules
       SET status = 'ACTIVE', version = 1, "liveKey" = 'live',
           "approvedByUserId" = 'u-finance-a', "approvedAt" = now()
     WHERE id = 'cr-haze';
    RAISE EXCEPTION 'The proposer was allowed to approve their own terms';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'maker/checker holds: the proposer cannot approve their own terms';
  END;
END $$;

UPDATE partner_contribution_rules
   SET status = 'ACTIVE', version = 1, "liveKey" = 'live',
       "approvedByUserId" = 'u-finance-b', "approvedAt" = now()
 WHERE id = 'cr-haze';

SELECT 'HAZE terms live: ' || kind || ' ' || "fixedPerUnit" || '/' || unit || ' v' || version
  AS result
  FROM partner_contribution_rules WHERE id = 'cr-haze';
