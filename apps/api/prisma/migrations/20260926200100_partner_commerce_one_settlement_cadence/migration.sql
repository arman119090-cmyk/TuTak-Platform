-- Partner Commerce settlement integration, step 2 (docs/PARTNER_COMMERCE.md §14).
--
-- Two cadence columns existed: `settlementPeriodicity` (+ `settlementAnchorDay`),
-- read by PartnerSettlementService on main, and Partner Commerce's own
-- `settlementPeriod`. From here `settlementPeriodicity` is the only one.
--
-- Nothing is overwritten silently. `settlementPeriod` only carries
-- information where a platform admin set it explicitly — every such change
-- was audited as PARTNER_SETTLEMENT_PERIOD_CHANGED; every other row holds the
-- column default, which says nothing about the partner. If an explicitly set
-- `settlementPeriod` differs from `settlementPeriodicity`, this migration
-- STOPS and names each partner: somebody must decide which cadence is real
-- (set `settlementPeriodicity`, or record the decision) before it can run.
DO $$
DECLARE
  conflicts TEXT;
BEGIN
  SELECT string_agg(
           format('%s "%s": settlementPeriod=%s vs settlementPeriodicity=%s',
                  p.id, p."displayName", p."settlementPeriod", p."settlementPeriodicity"),
           '; ' ORDER BY p.id)
    INTO conflicts
    FROM "partners" p
   WHERE p."settlementPeriod"::text <> p."settlementPeriodicity"::text
     AND EXISTS (
       SELECT 1 FROM "audit_logs" a
        WHERE a."action"::text = 'PARTNER_SETTLEMENT_PERIOD_CHANGED'
          AND a."entityId" = p.id
     );
  IF conflicts IS NOT NULL THEN
    RAISE EXCEPTION 'Settlement cadence conflict, nothing changed. An explicitly set settlementPeriod differs from settlementPeriodicity for: %. Set settlementPeriodicity to the intended cadence, then re-run.', conflicts;
  END IF;
END $$;

-- Safe now: every value left in the column is either the untouched default
-- or already equal to settlementPeriodicity; the audit log keeps every change.
ALTER TABLE "partners" DROP COLUMN "settlementPeriod";
