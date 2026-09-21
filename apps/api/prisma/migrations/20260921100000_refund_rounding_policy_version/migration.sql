-- Audit 21.09.2026, D09: the refund split across funding components changed
-- from independently rounded per-component watermarks (v1) to a cumulative
-- allocator in which each component is derived from the previous one's
-- remainder (v2), so the external slice can never be manufactured or
-- negative. Every existing row was computed under v1 and is stamped so;
-- new rows default to 2. A purchase partially refunded under v1 that also
-- used stored money is refused automatic continuation under v2 (see
-- `PurchaseIntentRefundService`) — no row is recomputed.
ALTER TABLE "purchase_intent_refunds"
  ADD COLUMN "roundingPolicyVersion" INTEGER NOT NULL DEFAULT 2;

UPDATE "purchase_intent_refunds" SET "roundingPolicyVersion" = 1;
